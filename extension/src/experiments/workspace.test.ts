import { Disposable, Disposer } from '@hediet/std/disposable'
import { Experiments } from '.'
import { WorkspaceExperiments } from './workspace'
import { quickPickOne } from '../vscode/quickPick'
import {
  CommandId,
  AvailableCommands,
  InternalCommands
} from '../commands/internal'
import { getInput } from '../vscode/inputBox'
import { buildMockMemento } from '../test/util'
import { buildMockedEventEmitter } from '../test/util/jest'
import { OutputChannel } from '../vscode/outputChannel'
import { Title } from '../vscode/title'
import { Args } from '../cli/dvc/constants'

const mockedShowWebview = jest.fn()
const mockedDisposable = jest.mocked(Disposable)
const mockedDvcRoot = '/my/dvc/root'
const mockedOtherDvcRoot = '/my/fun/dvc/root'
const mockedQuickPickOne = jest.mocked(quickPickOne)
const mockedPickExperiment = jest.fn()
const mockedGetInput = jest.mocked(getInput)
const mockedRun = jest.fn()
const mockedExpFunc = jest.fn()

jest.mock('vscode')
jest.mock('@hediet/std/disposable')
jest.mock('../vscode/quickPick')
jest.mock('../vscode/inputBox')

beforeEach(() => {
  jest.resetAllMocks()
})

describe('Experiments', () => {
  mockedDisposable.fn.mockReturnValue({
    track: function <T>(disposable: T): T {
      return disposable
    }
  } as unknown as (() => void) & Disposer)

  const mockedInternalCommands = new InternalCommands({
    show: jest.fn()
  } as unknown as OutputChannel)

  const mockedCommandId = 'mockedExpFunc' as CommandId
  mockedInternalCommands.registerCommand(mockedCommandId, (...args) =>
    mockedExpFunc(...args)
  )

  mockedInternalCommands.registerCommand(
    AvailableCommands.EXPERIMENT_RUN,
    (...args) => mockedRun(...args)
  )

  const mockedUpdatesPaused = buildMockedEventEmitter<boolean>()

  const workspaceExperiments = new WorkspaceExperiments(
    mockedInternalCommands,
    mockedUpdatesPaused,
    buildMockMemento(),
    {
      '/my/dvc/root': {
        getDvcRoot: () => mockedDvcRoot,
        pickExperiment: mockedPickExperiment,
        showWebview: mockedShowWebview
      } as unknown as Experiments,
      '/my/fun/dvc/root': {
        getDvcRoot: () => mockedOtherDvcRoot,
        pickExperiment: jest.fn(),
        showWebview: jest.fn()
      } as unknown as Experiments
    },
    buildMockedEventEmitter()
  )

  describe('getCwdThenReport', () => {
    it('should call the correct function with the correct parameters if a project is picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)

      await workspaceExperiments.getCwdThenReport(mockedCommandId)

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledWith(mockedDvcRoot)
    })

    it('should not call the function if a project is not picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(undefined)

      await workspaceExperiments.getCwdThenReport(mockedCommandId)

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })
  })

  describe('pauseUpdatesThenRun', () => {
    it('should pause updates, run the function and then flush the queue', async () => {
      const mockedFunc = jest.fn()

      await workspaceExperiments.pauseUpdatesThenRun(mockedFunc)

      expect(mockedUpdatesPaused.fire).toHaveBeenCalledTimes(2)
      expect(mockedUpdatesPaused.fire).toHaveBeenCalledWith(true)
      expect(mockedUpdatesPaused.fire).toHaveBeenLastCalledWith(false)
      expect(mockedFunc).toHaveBeenCalledTimes(1)
    })
  })

  describe('getExpNameThenRun', () => {
    it('should call the correct function with the correct parameters if a project and experiment are picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)
      mockedPickExperiment.mockResolvedValueOnce({
        id: 'a123456',
        name: 'exp-123'
      })

      await workspaceExperiments.getCwdAndExpNameThenRun(mockedCommandId)

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedPickExperiment).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledWith(mockedDvcRoot, 'exp-123')
    })

    it('should not call the function if a project is not picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(undefined)

      await workspaceExperiments.getCwdAndExpNameThenRun(mockedCommandId)

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })
  })

  describe('getCwdAndQuickPickThenRun', () => {
    it('should call the correct function with the correct parameters if a project and experiment are picked and the quick pick returns a list', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)

      const mockedPickedOptions = ['a', 'b', 'c']
      const mockedQuickPick = jest
        .fn()
        .mockResolvedValueOnce(mockedPickedOptions)
      await workspaceExperiments.getCwdAndQuickPickThenRun(
        mockedCommandId,
        mockedQuickPick
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedQuickPick).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledWith(
        mockedDvcRoot,
        ...mockedPickedOptions
      )
    })

    it('should not call the function or ask for quick picks if a project is not picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(undefined)
      const mockedQuickPick = jest.fn()

      await workspaceExperiments.getCwdAndQuickPickThenRun(
        mockedCommandId,
        mockedQuickPick
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedQuickPick).not.toHaveBeenCalled()
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })

    it('should not call the function if quick picks are not provided', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)
      const mockedQuickPick = jest.fn().mockResolvedValueOnce(undefined)

      await workspaceExperiments.getCwdAndQuickPickThenRun(
        mockedCommandId,
        mockedQuickPick
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedQuickPick).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })
  })

  describe('getCwdExpNameAndInputThenRun', () => {
    it('should call the correct function with the correct parameters if a project and experiment are picked and an input provided', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)
      mockedPickExperiment.mockResolvedValueOnce({
        id: 'a123456',
        name: 'exp-123'
      })
      mockedGetInput.mockResolvedValueOnce('abc123')

      await workspaceExperiments.getCwdExpNameAndInputThenRun(
        (cwd: string, ...args: Args) =>
          workspaceExperiments.runCommand(mockedCommandId, cwd, ...args),
        'enter your password please' as Title
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedPickExperiment).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).toHaveBeenCalledWith(
        mockedDvcRoot,
        'exp-123',
        'abc123'
      )
    })

    it('should not call the function or ask for input if a project is not picked', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(undefined)

      await workspaceExperiments.getCwdExpNameAndInputThenRun(
        (cwd: string, ...args: Args) =>
          workspaceExperiments.runCommand(mockedCommandId, cwd, ...args),
        'please name the branch' as Title
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedGetInput).not.toHaveBeenCalled()
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })

    it('should not call the function if user input is not provided', async () => {
      mockedQuickPickOne.mockResolvedValueOnce(mockedDvcRoot)
      mockedPickExperiment.mockResolvedValueOnce({
        id: 'b456789',
        name: 'exp-456'
      })
      mockedGetInput.mockResolvedValueOnce(undefined)

      await workspaceExperiments.getCwdExpNameAndInputThenRun(
        (cwd: string, ...args: Args) =>
          workspaceExperiments.runCommand(mockedCommandId, cwd, ...args),
        'please enter your bank account number and sort code' as Title
      )

      expect(mockedQuickPickOne).toHaveBeenCalledTimes(1)
      expect(mockedGetInput).toHaveBeenCalledTimes(1)
      expect(mockedExpFunc).not.toHaveBeenCalled()
    })
  })
})
