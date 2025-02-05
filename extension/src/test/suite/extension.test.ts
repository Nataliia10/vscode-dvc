import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, it, suite } from 'mocha'
import { expect } from 'chai'
import { stub, restore, spy, match } from 'sinon'
import { window, commands, workspace } from 'vscode'
import {
  closeAllEditors,
  mockDisposable,
  mockDuration,
  quickPickInitialized,
  selectQuickPickItem
} from './util'
import { mockHasCheckpoints } from './experiments/util'
import { Disposable } from '../../extension'
import * as Python from '../../extensions/python'
import { DvcReader } from '../../cli/dvc/reader'
import expShowFixture from '../fixtures/expShow/base/output'
import plotsDiffFixture from '../fixtures/plotsDiff/output'
import * as Disposer from '../../util/disposable'
import { RegisteredCommands } from '../../commands/external'
import * as Telemetry from '../../telemetry'
import { EventName } from '../../telemetry/constants'
import { OutputChannel } from '../../vscode/outputChannel'
import { WorkspaceExperiments } from '../../experiments/workspace'
import { GitReader } from '../../cli/git/reader'
import { MIN_CLI_VERSION } from '../../cli/dvc/contract'
import { ConfigKey, setConfigValue } from '../../vscode/config'
import { DvcExecutor } from '../../cli/dvc/executor'
import { dvcDemoPath } from '../util'
import { Setup } from '../../setup'
import { Flag } from '../../cli/dvc/constants'

suite('Extension Test Suite', () => {
  const disposable = Disposable.fn()

  beforeEach(() => {
    restore()
  })

  afterEach(function () {
    this.timeout(6000)
    disposable.dispose()
    return Promise.all([
      workspace.getConfiguration().update(ConfigKey.DVC_PATH, undefined, false),
      workspace
        .getConfiguration()
        .update(ConfigKey.PYTHON_PATH, undefined, false),
      closeAllEditors()
    ])
  })

  describe('dvc.setupWorkspace', () => {
    it('should initialize the extension when the cli is usable', async () => {
      stub(Python, 'isPythonExtensionInstalled').returns(true)
      const selectVirtualEnvWithPython = async (path: string) => {
        const mockShowQuickPick = stub(window, 'showQuickPick')

        const venvQuickPickActive = quickPickInitialized(mockShowQuickPick, 0)

        const setupWorkspaceWizard = commands.executeCommand(
          RegisteredCommands.EXTENSION_SETUP_WORKSPACE
        )

        const mockSelectPythonInterpreter = stub(
          Python,
          'selectPythonInterpreter'
        )
        const executeCommandCalled = new Promise(resolve =>
          mockSelectPythonInterpreter.callsFake(() => {
            void setConfigValue(ConfigKey.PYTHON_PATH, path)
            resolve(undefined)
          })
        )

        await venvQuickPickActive

        await selectQuickPickItem(1)

        await executeCommandCalled

        mockSelectPythonInterpreter.restore()

        mockShowQuickPick.restore()

        return setupWorkspaceWizard
      }

      const mockCreateFileSystemWatcher = stub(
        workspace,
        'createFileSystemWatcher'
      ).returns({
        dispose: () => undefined,
        ignoreChangeEvents: false,
        ignoreCreateEvents: false,
        ignoreDeleteEvents: false,
        onDidChange: () => mockDisposable,
        onDidCreate: () => mockDisposable,
        onDidDelete: () => mockDisposable
      })

      const mockCanRunCli = stub(DvcReader.prototype, 'version')
        .onFirstCall()
        .resolves(MIN_CLI_VERSION)
        .onSecondCall()
        .rejects('CLI is gone, dispose of everything')

      const mockDisposer = stub(Disposer, 'reset')

      const disposalEvent = () =>
        new Promise(resolve => {
          mockDisposer.resetBehavior()
          mockDisposer.resetHistory()
          mockDisposer.callsFake((...args) => {
            resolve(undefined)
            return mockDisposer.wrappedMethod(...args)
          })
        })

      const firstDisposal = disposalEvent()

      const mockSendTelemetryEvent = stub(Telemetry, 'sendTelemetryEvent')
      const correctTelemetryEventSent = new Promise(resolve =>
        mockSendTelemetryEvent.callsFake((eventName: string) => {
          if (eventName === EventName.EXTENSION_EXECUTION_DETAILS_CHANGED) {
            resolve(undefined)
          }
        })
      )

      mockHasCheckpoints(expShowFixture)
      const mockExpShow = stub(DvcReader.prototype, 'expShow').resolves(
        expShowFixture
      )

      stub(DvcReader.prototype, 'root').resolves('.')

      const mockDataStatus = stub(DvcReader.prototype, 'dataStatus').resolves({
        committed: {
          added: [],
          deleted: [],
          modified: [],
          renamed: []
        },
        not_in_cache: [],
        unchanged: [
          join('data', 'MNIST', 'raw', 't10k-images-idx3-ubyte'),
          join('data', 'MNIST', 'raw', 't10k-images-idx3-ubyte.gz'),
          join('data', 'MNIST', 'raw', 't10k-labels-idx1-ubyte'),
          join('data', 'MNIST', 'raw', 't10k-labels-idx1-ubyte.gz'),
          join('data', 'MNIST', 'raw', 'train-images-idx3-ubyte'),
          join('data', 'MNIST', 'raw', 'train-images-idx3-ubyte.gz'),
          join('data', 'MNIST', 'raw', 'train-labels-idx1-ubyte'),
          join('data', 'MNIST', 'raw', 'train-labels-idx1-ubyte.gz'),
          join('logs', 'acc.tsv'),
          join('logs', 'loss.tsv')
        ],
        uncommitted: {
          added: [],
          deleted: [],
          modified: ['model.pt', join('data', 'MNIST', 'raw'), 'logs'],
          renamed: []
        }
      })

      stub(DvcReader.prototype, 'plotsDiff').resolves(plotsDiffFixture)

      const mockWorkspaceExperimentsReady = stub(
        WorkspaceExperiments.prototype,
        'isReady'
      )

      stub(GitReader.prototype, 'hasChanges').resolves(false)
      stub(GitReader.prototype, 'listUntracked').resolves(new Set())

      const workspaceExperimentsAreReady = new Promise(resolve =>
        mockWorkspaceExperimentsReady.callsFake(async () => {
          await mockWorkspaceExperimentsReady.wrappedMethod()
          resolve(undefined)
        })
      )

      const mockPath = resolve('path', 'to', 'venv')

      await selectVirtualEnvWithPython(resolve('path', 'to', 'venv'))

      await Promise.all([firstDisposal, correctTelemetryEventSent])

      expect(
        await workspace.getConfiguration().get(ConfigKey.PYTHON_PATH)
      ).to.equal(mockPath)

      expect(
        mockCanRunCli,
        'should have checked to see if the cli could be run with the given execution details'
      ).to.have.been.called
      expect(mockDataStatus, 'should have updated the repository data').to.have
        .been.called
      expect(mockExpShow, 'should have updated the experiments data').to.have
        .been.called

      expect(
        mockSendTelemetryEvent,
        'should send the correct event details'
      ).to.be.calledWithExactly(
        EventName.EXTENSION_EXECUTION_DETAILS_CHANGED,
        {
          cliAccessible: true,
          deps: 8,
          dvcPathUsed: false,
          dvcRootCount: 1,
          hasCheckpoints: 1,
          images: 3,
          metrics: 4,
          msPythonInstalled: true,
          msPythonUsed: false,
          noCheckpoints: 0,
          params: 9,
          pythonPathUsed: true,
          templates: 3,
          tracked: 13,
          workspaceFolderCount: 1
        },
        match.has('duration')
      )

      expect(
        mockDisposer,
        'should dispose of the current repositories and experiments before creating new ones'
      ).to.have.been.called

      await workspaceExperimentsAreReady
      const secondDisposal = disposalEvent()

      await selectVirtualEnvWithPython(resolve('path', 'to', 'virtualenv'))

      await secondDisposal

      expect(
        mockDisposer,
        'should dispose of the current repositories and experiments if the cli can no longer be found'
      ).to.have.been.called

      expect(mockCreateFileSystemWatcher).not.to.be.calledWithMatch('{}')
    }).timeout(25000)
  })

  describe('dvc.stopAllRunningExperiments', () => {
    it('should send a telemetry event containing properties relating to the event', async () => {
      const duration = 1234
      const otherRoot = resolve('other', 'root')
      mockDuration(duration)

      const mockSendTelemetryEvent = stub(Telemetry, 'sendTelemetryEvent')
      const mockQueueStop = stub(DvcExecutor.prototype, 'queueStop').resolves(
        undefined
      )

      stub(Setup.prototype, 'getRoots').returns([dvcDemoPath, otherRoot])

      await commands.executeCommand(RegisteredCommands.STOP_EXPERIMENTS)

      expect(mockSendTelemetryEvent).to.be.calledWith(
        RegisteredCommands.STOP_EXPERIMENTS,
        {
          stopped: false,
          wasRunning: false
        },
        {
          duration
        }
      )

      expect(mockQueueStop).to.be.calledWith(dvcDemoPath, Flag.KILL)
      expect(mockQueueStop).to.be.calledWith(otherRoot, Flag.KILL)
    })
  })

  describe('dvc.showCommands', () => {
    it('should show all of the dvc commands without error', async () => {
      await expect(
        commands.executeCommand(RegisteredCommands.EXTENSION_SHOW_COMMANDS)
      ).to.be.eventually.equal(undefined)
    })
  })

  describe('dvc.showOutput', () => {
    it('should be able to show the output channel', async () => {
      const showOutputSpy = spy(OutputChannel.prototype, 'show')
      await commands.executeCommand(RegisteredCommands.EXTENSION_SHOW_OUTPUT)
      expect(showOutputSpy).to.have.been.calledOnce
    })
  })

  describe('view container', () => {
    it('should be able to focus the experiments view container', async () => {
      await expect(
        commands.executeCommand('workbench.view.extension.dvc-views')
      ).to.be.eventually.equal(undefined)
    })
  })
})
