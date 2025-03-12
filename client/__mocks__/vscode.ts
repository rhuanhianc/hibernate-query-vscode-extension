// __mocks__/vscode.ts - Mock para o módulo vscode

const workspace = {
    getConfiguration: jest.fn().mockImplementation((section) => {
      // Valores padrão para configurações usadas no QueryClient
      if (section === 'queryTester') {
        return {
          get: jest.fn().mockImplementation((key) => {
            const defaults: Record<string, any> = {
              serverPort: 8089,
              serverHost: '127.0.0.1',
              hibernateVersion: '5.4.30.Final',
              responseTimeout: 60000
            };
            return defaults[key];
          })
        };
      }
      return {
        get: jest.fn().mockReturnValue(undefined)
      };
    })
  };
  
  const window = {
    showInformationMessage: jest.fn(),
    showErrorMessage: jest.fn()
  };
  
  export { workspace, window };