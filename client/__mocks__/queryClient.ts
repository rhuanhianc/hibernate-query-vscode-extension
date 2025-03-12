// __mocks__/queryClient.ts

export class QueryClient {
    private serverPort: number;
    private serverHost: string;
    private hibernateVersion: string;
    private responseTimeout: number;
  
    constructor(port?: number) {
      this.serverPort = port || 8089;
      this.serverHost = '127.0.0.1';
      this.hibernateVersion = '5.4.30.Final';
      this.responseTimeout = 60000;
    }
  
    public executeQuery = jest.fn().mockImplementation((query, params, isNative, config = {}) => {
      // Simula diferentes resultados com base no tipo de consulta
      if (query.includes('SELECT * FROM users')) {
        return Promise.resolve([
          { id: 1, name: 'John', email: 'john@example.com' },
          { id: 2, name: 'Jane', email: 'jane@example.com' }
        ]);
      } else if (query.includes('JOIN')) {
        return Promise.resolve([
          { user_id: 1, user_name: 'John', order_id: 101, order_date: '2023-01-15' },
          { user_id: 1, user_name: 'John', order_id: 102, order_date: '2023-02-20' },
          { user_id: 2, user_name: 'Jane', order_id: 103, order_date: '2023-03-10' }
        ]);
      } else if (isNative) {
        return Promise.resolve([
          { count: 5, category: 'electronics' },
          { count: 3, category: 'books' },
          { count: 2, category: 'clothing' }
        ]);
      } else {
        return Promise.resolve([
          { id: 1, name: 'Default Result' }
        ]);
      }
    });
  
    public sendRequest = jest.fn().mockImplementation((request) => {
      if (request.command === 'executeQuery') {
        return this.executeQuery(
          request.query,
          request.params,
          request.isNative,
          {
            dbConfig: request.dbConfig,
            entityLibPath: request.entityLibPath,
            entityPackages: request.entityPackages,
            projectScan: request.projectScan,
            hibernateVersion: request.hibernateVersion
          }
        );
      }
      return Promise.resolve({});
    });
  
    public getServerHost(): string {
      return this.serverHost;
    }
  
    public getServerPort(): number {
      return this.serverPort;
    }
  
    public getHibernateVersion(): string {
      return this.hibernateVersion;
    }
  
    public getResponseTimeout(): number {
      return this.responseTimeout;
    }
  
    public destroy = jest.fn();
  }