jest.mock('./src/util/styles', () => {
  const actualModule = jest.requireActual('./src/util/styles')
  return {
    __esModule: true,
    ...actualModule,
    getThemeValue: jest.fn().mockImplementation(() => '#ffffff')
  }
})

// eslint-disable-next-line no-global-assign
window = {
  addEventListener: jest.fn(),
  dispatchEvent: jest.fn()
}

const mutationObserverMock = jest.fn().mockImplementation(() => {
  return {
    disconnect: jest.fn(),
    observe: jest.fn(),
    takeRecords: jest.fn()
  }
})
global.MutationObserver = mutationObserverMock

const intersectionObserverMock = jest.fn().mockImplementation(() => {
  return {
    disconnect: jest.fn(),
    observe: jest.fn(),
    unobserve: jest.fn()
  }
})
global.IntersectionObserver = intersectionObserverMock
