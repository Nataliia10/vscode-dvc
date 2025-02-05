import { resolve } from 'path'
import { Disposable } from '@hediet/std/disposable'
import { afterEach, beforeEach, describe, it, suite } from 'mocha'
import { expect } from 'chai'
import { restore, spy, stub } from 'sinon'
import { commands, EventEmitter } from 'vscode'
import { DvcRunner } from '../../cli/dvc/runner'
import { WorkspaceExperiments } from '../../experiments/workspace'
import { Context } from '../../context'
import { FilterDefinition } from '../../experiments/model/filterBy'
import { SortDefinition } from '../../experiments/model/sortBy'

suite('Context Test Suite', () => {
  const disposable = Disposable.fn()

  const buildContext = (runnerRunning: boolean) => {
    const executeCommandSpy = spy(commands, 'executeCommand')

    const processStarted = disposable.track(new EventEmitter<void>())
    const processCompleted = disposable.track(new EventEmitter<void>())
    const onDidStartProcess = processStarted.event
    const onDidCompleteProcess = processCompleted.event

    const experimentsChanged = disposable.track(new EventEmitter<void>())
    const onDidChangeExperiments = experimentsChanged.event

    const mockGetDvcRoots = stub().returns([])
    const mockGetRepository = stub().returns({
      update: stub()
    })

    const mockHasDvcLiveOnlyExperimentRunning = stub()

    const mockDvcRunner = {
      isExperimentRunning: () => runnerRunning,
      onDidCompleteProcess,
      onDidStartProcess
    } as unknown as DvcRunner
    const mockExperiments = {
      getDvcRoots: mockGetDvcRoots,
      getRepository: mockGetRepository,
      hasDvcLiveOnlyExperimentRunning: mockHasDvcLiveOnlyExperimentRunning,
      onDidChangeExperiments
    } as unknown as WorkspaceExperiments

    const context = disposable.track(
      new Context(mockExperiments, mockDvcRunner)
    )

    return {
      context,
      executeCommandSpy,
      experimentsChanged,
      mockDvcRunner,
      mockExperiments,
      mockGetDvcRoots,
      mockGetRepository,
      mockHasDvcLiveOnlyExperimentRunning,
      onDidChangeExperiments,
      onDidCompleteProcess,
      onDidStartProcess,
      processCompleted,
      processStarted
    }
  }

  const buildMockExperiments = (
    filters: FilterDefinition[] = [],
    sorts: SortDefinition[] = [],
    experimentRunning = false,
    queuedExperimentRunning = false
  ) => {
    return {
      getFilters: () => filters,
      getSorts: () => sorts,
      hasRunningExperiment: () => experimentRunning,
      hasRunningQueuedExperiment: () => queuedExperimentRunning
    }
  }

  beforeEach(() => {
    restore()
  })

  afterEach(() => {
    disposable.dispose()
  })

  // eslint-disable-next-line sonarjs/cognitive-complexity
  describe('Context', () => {
    it('should set the dvc.experiment.running and dvc.experiment.stoppable context to true whenever an experiment is running in the runner', async () => {
      const { executeCommandSpy, onDidStartProcess, processStarted } =
        buildContext(true)

      const processStartedEvent = new Promise(resolve =>
        disposable.track(onDidStartProcess(() => resolve(undefined)))
      )

      processStarted.fire()
      await processStartedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.running',
        true
      )

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.stoppable',
        true
      )
    })

    it('should set the dvc.experiment.running context to true whenever the data shows an experiment is running', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        onDidChangeExperiments
      } = buildContext(false)

      const experimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('first', 'root')
      const mockOtherDvcRoot = resolve('second', 'root')

      mockGetDvcRoots.returns([mockDvcRoot, mockOtherDvcRoot])
      mockGetRepository.callsFake(dvcRoot => {
        if (dvcRoot === mockDvcRoot) {
          return buildMockExperiments([], [], true)
        }
        if (dvcRoot === mockOtherDvcRoot) {
          return buildMockExperiments()
        }
      })

      experimentsChanged.fire()
      await experimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.running',
        true
      )
    })

    it('should set the dvc.experiment.running context to false whenever the runner is not running and the data shows no experiment is running', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        onDidChangeExperiments
      } = buildContext(false)

      const experimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('first', 'root')
      mockGetDvcRoots.returns([mockDvcRoot])
      mockGetRepository.callsFake(() => buildMockExperiments())

      experimentsChanged.fire()
      await experimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.running',
        false
      )
    })

    it('should set the dvc.experiment.stoppable context to whether or not there is a DVCLive only experiment running if an experiment is not running in the runner or queue', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        mockHasDvcLiveOnlyExperimentRunning,
        onDidChangeExperiments
      } = buildContext(false)

      const dvcLiveOnlyRunningEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('first', 'root')
      mockGetDvcRoots.returns([mockDvcRoot])
      mockGetRepository.callsFake(() => buildMockExperiments())

      mockHasDvcLiveOnlyExperimentRunning.resolves(true)

      experimentsChanged.fire()
      await dvcLiveOnlyRunningEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.stoppable',
        true
      )
      mockHasDvcLiveOnlyExperimentRunning.resetBehavior()
      executeCommandSpy.resetHistory()

      const dvcLiveOnlyStoppedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      mockHasDvcLiveOnlyExperimentRunning.resolves(false)

      experimentsChanged.fire()
      await dvcLiveOnlyStoppedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.stoppable',
        false
      )
    })

    it('should set the dvc.experiment.stoppable context to true if an experiment is running in the queue', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        mockHasDvcLiveOnlyExperimentRunning,
        onDidChangeExperiments
      } = buildContext(false)

      const queuedExperimentRunningEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('first', 'root')
      mockGetDvcRoots.returns([mockDvcRoot])
      let hasRunningQueuedExperiment = true
      mockGetRepository.callsFake(() =>
        buildMockExperiments([], [], false, hasRunningQueuedExperiment)
      )

      mockHasDvcLiveOnlyExperimentRunning.resolves(false)

      experimentsChanged.fire()
      await queuedExperimentRunningEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.stoppable',
        true
      )
      executeCommandSpy.resetHistory()

      const queuedExperimentStoppedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )
      hasRunningQueuedExperiment = false
      experimentsChanged.fire()
      await queuedExperimentStoppedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiment.stoppable',
        false
      )
    })

    it('should set the dvc.experiments.filtered context correctly depending on whether there are filters applied', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        onDidChangeExperiments
      } = buildContext(false)

      const firstExperimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('mock', 'root')
      mockGetDvcRoots.returns([mockDvcRoot])
      mockGetRepository.callsFake(() => buildMockExperiments())

      experimentsChanged.fire()
      await firstExperimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiments.filtered',
        false
      )

      executeCommandSpy.resetHistory()
      mockGetRepository.resetBehavior()
      mockGetRepository.callsFake(() =>
        buildMockExperiments([{} as FilterDefinition])
      )

      const secondExperimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      experimentsChanged.fire()
      await secondExperimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiments.filtered',
        true
      )
    })

    it('should set the dvc.experiments.sorted context correctly depending on whether there are sorts applied', async () => {
      const {
        executeCommandSpy,
        experimentsChanged,
        mockGetDvcRoots,
        mockGetRepository,
        onDidChangeExperiments
      } = buildContext(false)

      const firstExperimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      const mockDvcRoot = resolve('mock', 'root')
      mockGetDvcRoots.returns([mockDvcRoot])
      mockGetRepository.callsFake(() => buildMockExperiments())

      experimentsChanged.fire()
      await firstExperimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiments.sorted',
        false
      )

      executeCommandSpy.resetHistory()
      mockGetRepository.resetBehavior()
      mockGetRepository.callsFake(() =>
        buildMockExperiments([], [{} as SortDefinition])
      )

      const secondExperimentsChangedEvent = new Promise(resolve =>
        disposable.track(onDidChangeExperiments(() => resolve(undefined)))
      )

      experimentsChanged.fire()
      await secondExperimentsChangedEvent

      expect(executeCommandSpy).to.be.calledWith(
        'setContext',
        'dvc.experiments.sorted',
        true
      )
    })
  })
})
