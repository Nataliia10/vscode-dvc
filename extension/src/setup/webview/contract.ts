export type SetupData = {
  canGitInitialize: boolean
  cliCompatible: boolean | undefined
  hasData: boolean | undefined
  isPythonExtensionInstalled: boolean
  needsGitInitialized: boolean | undefined
  projectInitialized: boolean
  pythonBinPath: string | undefined
}
