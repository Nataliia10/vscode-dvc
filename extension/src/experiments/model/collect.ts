import {
  MarkdownString,
  ThemeIcon,
  TreeItemCollapsibleState,
  Uri
} from 'vscode'
import omit from 'lodash.omit'
import { ExperimentType } from '.'
import { ExperimentsAccumulator } from './accumulator'
import { extractColumns } from '../columns/extract'
import {
  Experiment,
  ColumnType,
  isRunning,
  CommitData
} from '../webview/contract'
import {
  ExperimentFieldsOrError,
  ExperimentFields,
  ExperimentsCommitOutput,
  ExperimentsOutput,
  EXPERIMENT_WORKSPACE_ID,
  ExperimentStatus
} from '../../cli/dvc/contract'
import { addToMapArray } from '../../util/map'
import { uniqueValues } from '../../util/array'
import { RegisteredCommands } from '../../commands/external'
import { Resource } from '../../resourceLocator'
import { shortenForLabel } from '../../util/string'
import { COMMITS_SEPARATOR } from '../../cli/git/constants'

export type ExperimentItem = {
  command?: {
    arguments: { dvcRoot: string; id: string }[]
    command: RegisteredCommands
    title: string
  }
  dvcRoot: string
  description: string | undefined
  id: string
  label: string
  collapsibleState: TreeItemCollapsibleState
  type: ExperimentType
  iconPath: ThemeIcon | Uri | Resource
  tooltip: MarkdownString | undefined
}

type ExperimentsObject = { [sha: string]: ExperimentFieldsOrError }

export const isCheckpoint = (
  checkpointTip: string | undefined,
  sha: string
): checkpointTip is string => !!(checkpointTip && checkpointTip !== sha)

const getExperimentId = (
  sha: string,
  experimentsFields?: ExperimentFields
): string => {
  if (!experimentsFields) {
    return sha
  }

  const { name, checkpoint_tip } = experimentsFields

  if (isCheckpoint(checkpoint_tip, sha)) {
    return sha
  }

  return name || sha
}

const getDisplayNameOrParent = (
  sha: string,
  commitSha: string,
  experimentsObject: { [sha: string]: ExperimentFieldsOrError }
): string | undefined => {
  const experiment = experimentsObject[sha]?.data
  if (!experiment) {
    return
  }

  const {
    checkpoint_parent: checkpointParent,
    checkpoint_tip: checkpointTip,
    name
  } = experiment
  if (
    checkpointParent &&
    commitSha !== checkpointParent &&
    experimentsObject[checkpointParent]?.data?.checkpoint_tip !== checkpointTip
  ) {
    return `(${shortenForLabel(checkpointParent)})`
  }
  if (name) {
    return `[${name}]`
  }
}

const getLogicalGroupName = (
  sha: string,
  commitSha: string,
  experimentsObject: { [sha: string]: ExperimentFieldsOrError }
): string | undefined => {
  const experiment = experimentsObject[sha]?.data

  const { checkpoint_tip: checkpointTip = undefined, name = undefined } =
    experiment || {}

  if (name) {
    return `[${name}]`
  }

  return (
    getDisplayNameOrParent(sha, commitSha, experimentsObject) ||
    (checkpointTip && checkpointTip !== sha
      ? getLogicalGroupName(checkpointTip, commitSha, experimentsObject)
      : undefined)
  )
}

const getCheckpointTipId = (
  checkpointTip: string | undefined,
  experimentsObject: ExperimentsObject
): string | undefined => {
  if (!checkpointTip) {
    return
  }

  const tip = experimentsObject[checkpointTip]?.data

  return tip?.name || checkpointTip
}

const transformColumns = (
  experiment: Experiment,
  experimentFields: ExperimentFields,
  commit?: Experiment
) => {
  const { error, metrics, params, deps, Created } = extractColumns(
    experimentFields,
    commit
  )

  if (Created) {
    experiment.Created = Created
  }
  if (metrics) {
    experiment.metrics = metrics
  }
  if (params) {
    experiment.params = params
  }
  if (deps) {
    experiment.deps = deps
  }
  if (error) {
    experiment.error = error
  }
}

const mergeErrors = (
  experimentFieldsOrError: ExperimentFieldsOrError
): string | undefined =>
  experimentFieldsOrError.error?.msg || experimentFieldsOrError.data?.error?.msg

const transformExperimentData = (
  id: string,
  experimentFieldsOrError: ExperimentFieldsOrError,
  label: string | undefined,
  sha?: string,
  displayNameOrParent?: string,
  logicalGroupName?: string,
  commit?: Experiment
): Experiment => {
  const data = experimentFieldsOrError.data || {}

  const error = mergeErrors(experimentFieldsOrError)

  const experiment = {
    id,
    label,
    ...omit(data, Object.values(ColumnType))
  } as Experiment

  if (displayNameOrParent) {
    experiment.displayNameOrParent = displayNameOrParent
  }

  if (logicalGroupName) {
    experiment.logicalGroupName = logicalGroupName
  }

  if (sha) {
    experiment.sha = sha
  }

  if (error) {
    experiment.error = error
  }

  transformColumns(experiment, data, commit)

  return experiment
}

const transformExperimentOrCheckpointData = (
  sha: string,
  experimentData: ExperimentFieldsOrError,
  experimentsObject: ExperimentsObject,
  commitSha: string,
  commit: Experiment
): {
  checkpointTipId?: string
  experiment: Experiment | undefined
} => {
  const experimentFields = experimentData.data
  if (!experimentFields) {
    const error = experimentData?.error?.msg
    return { experiment: { error, id: sha, label: shortenForLabel(sha) } }
  }

  const checkpointTipId = getCheckpointTipId(
    experimentFields.checkpoint_tip,
    experimentsObject
  )

  const id = getExperimentId(sha, experimentFields)

  return {
    checkpointTipId,
    experiment: transformExperimentData(
      id,
      experimentData,
      shortenForLabel(sha),
      sha,
      getDisplayNameOrParent(sha, commitSha, experimentsObject),
      getLogicalGroupName(sha, commitSha, experimentsObject),
      commit
    )
  }
}

const collectHasRunningExperiment = (
  acc: ExperimentsAccumulator,
  experiment: Experiment
) => {
  const { executor, id, status } = experiment
  if (isRunning(status) && executor) {
    acc.runningExperiments.push({ executor, id })
  }
}

const collectExperimentOrCheckpoint = (
  acc: ExperimentsAccumulator,
  experiment: Experiment,
  commitName: string,
  checkpointTipId: string | undefined
) => {
  const { checkpoint_tip: checkpointTip, sha } = experiment
  if (isCheckpoint(checkpointTip, sha as string)) {
    if (!checkpointTipId) {
      return
    }
    addToMapArray(acc.checkpointsByTip, checkpointTipId, experiment)
    return
  }
  addToMapArray(acc.experimentsByCommit, commitName, experiment)
}

const collectFromExperimentsObject = (
  acc: ExperimentsAccumulator,
  experimentsObject: ExperimentsObject,
  commitSha: string,
  commit: Experiment
) => {
  const commitName = commit.label

  for (const [sha, experimentData] of Object.entries(experimentsObject)) {
    const { checkpointTipId, experiment } = transformExperimentOrCheckpointData(
      sha,
      experimentData,
      experimentsObject,
      commitSha,
      commit
    )
    if (!experiment) {
      continue
    }

    collectExperimentOrCheckpoint(acc, experiment, commitName, checkpointTipId)
    collectHasRunningExperiment(acc, experiment)
  }
}

const collectFromCommits = (
  acc: ExperimentsAccumulator,
  commitsObject: { [name: string]: ExperimentsCommitOutput }
) => {
  for (const [sha, { baseline, ...experimentsObject }] of Object.entries(
    commitsObject
  )) {
    let name = baseline.data?.name
    let label = name

    if (!name) {
      name = sha
      label = shortenForLabel(name)
    }
    const commit = transformExperimentData(name, baseline, label, sha)

    if (commit) {
      collectFromExperimentsObject(acc, experimentsObject, sha, commit)
      collectHasRunningExperiment(acc, commit)

      acc.commits.push(commit)
    }
  }
}

const getCommitDataFromOutput = (
  output: string
): CommitData & { hash: string } => {
  const data: CommitData & { hash: string } = {
    author: '',
    date: '',
    hash: '',
    message: '',
    tags: []
  }
  const [hash, author, date, refNamesWithKey] = output
    .split('\n')
    .filter(Boolean)
  data.hash = hash
  data.author = author
  data.date = date

  const message = output.match(/\nmessage:(.+)/s) || []
  data.message = message[1] || ''

  const refNames = refNamesWithKey.slice('refNames:'.length)
  data.tags = refNames
    .split(', ')
    .filter(item => item.startsWith('tag: '))
    .map(item => item.slice('tag: '.length))

  return data
}

const formatCommitMessage = (commit: string) => {
  const lines = commit.split('\n').filter(Boolean)
  return `${lines[0]}${lines.length > 1 ? ' ...' : ''}`
}

const getCommitMessages = (
  commitsOutput: string
): { [sha: string]: CommitData } => {
  if (!commitsOutput) {
    return {}
  }
  const commits = commitsOutput.split(COMMITS_SEPARATOR).map(commit => {
    const { hash, ...rest } = getCommitDataFromOutput(commit)
    return [hash, { ...rest }]
  })
  return Object.fromEntries(commits) as { [sha: string]: CommitData }
}

const addDataToCommits = (
  commits: Experiment[],
  commitsOutput: string
): Experiment[] => {
  const commitMessages = getCommitMessages(commitsOutput)
  return commits.map(commit => {
    const { sha } = commit
    if (sha && commitMessages[sha]) {
      commit.displayNameOrParent = formatCommitMessage(
        commitMessages[sha].message
      )
      commit.commit = commitMessages[sha]
    }
    return commit
  })
}

export const collectExperiments = (
  data: ExperimentsOutput,
  dvcLiveOnly: boolean,
  commitsOutput: string
): ExperimentsAccumulator => {
  const { workspace, ...commitsObject } = data

  const workspaceBaseline = transformExperimentData(
    EXPERIMENT_WORKSPACE_ID,
    workspace.baseline,
    EXPERIMENT_WORKSPACE_ID
  )

  if (dvcLiveOnly) {
    workspaceBaseline.executor = EXPERIMENT_WORKSPACE_ID
    workspaceBaseline.status = ExperimentStatus.RUNNING
  }

  const acc = new ExperimentsAccumulator(workspaceBaseline)

  collectFromCommits(acc, commitsObject)

  acc.commits = addDataToCommits(acc.commits, commitsOutput)

  return acc
}

const getDefaultMutableRevision = (): string[] => [EXPERIMENT_WORKSPACE_ID]

const collectMutableRevision = (
  acc: string[],
  { label, status }: Experiment,
  hasCheckpoints: boolean
) => {
  if (isRunning(status) && !hasCheckpoints) {
    acc.push(label)
  }
}

export const collectMutableRevisions = (
  experiments: Experiment[],
  hasCheckpoints: boolean
): string[] => {
  const acc = getDefaultMutableRevision()

  for (const experiment of experiments) {
    collectMutableRevision(acc, experiment, hasCheckpoints)
  }

  return uniqueValues(acc)
}

type DeletableExperimentAccumulator = { [dvcRoot: string]: Set<string> }

const initializeAccumulatorRoot = (
  acc: DeletableExperimentAccumulator,
  dvcRoot: string
) => {
  if (!acc[dvcRoot]) {
    acc[dvcRoot] = new Set<string>()
  }
}

const collectExperimentItem = (
  acc: DeletableExperimentAccumulator,
  deletable: Set<string>,
  experimentItem: ExperimentItem
) => {
  const { dvcRoot, type, id, label } = experimentItem
  if (!deletable.has(type)) {
    return
  }
  initializeAccumulatorRoot(acc, dvcRoot)
  if (type === ExperimentType.QUEUED) {
    acc[dvcRoot].add(label)
    return
  }

  acc[dvcRoot].add(id)
}

export const collectDeletable = (
  experimentItems: (string | ExperimentItem)[]
): DeletableExperimentAccumulator => {
  const deletable = new Set([ExperimentType.EXPERIMENT, ExperimentType.QUEUED])

  const acc: DeletableExperimentAccumulator = {}
  for (const experimentItem of experimentItems) {
    if (typeof experimentItem === 'string') {
      continue
    }

    collectExperimentItem(acc, deletable, experimentItem)
  }

  return acc
}
