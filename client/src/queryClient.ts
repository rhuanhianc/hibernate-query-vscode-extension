import * as net from 'net';
import * as vscode from 'vscode';
import { Logger } from './logger';

export class QueryClient {
    private client: net.Socket;
    private isConnected: boolean = false;
    private isConnecting: boolean = false;
    private maxRetries: number = 5;
    private retryDelay: number = 1000;
    private retryCount: number = 0;
    private serverPort: number;
    private serverHost: string;
    private hibernateVersion: string;
    private logger: Logger;

    constructor(port?: number) {
        this.client = new net.Socket();
        this.logger = Logger.getInstance();

        // Get connection settings
        const config = vscode.workspace.getConfiguration('queryTester');
        this.serverPort = port || config.get('serverPort') || 8089;
        this.serverHost = config.get('serverHost') || '127.0.0.1';
        this.hibernateVersion = config.get('hibernateVersion') || '5.4.30.Final';

        this.connect();
    }
    private async connect(): Promise<void> {
        if (this.isConnecting || this.isConnected) return;

        this.isConnecting = true;
        this.retryCount = 0;

        while (this.retryCount < this.maxRetries && !this.isConnected) {
            try {
                this.logger.info(`Connection attempt ${this.retryCount + 1}/${this.maxRetries} to server ${this.serverHost}:${this.serverPort}`);
                await this.attemptConnection();
            } catch (err: any) {
                this.logger.error(`Connection error (attempt ${this.retryCount + 1}): ${err.message}`);
                if (err.message.includes('ECONNREFUSED')) {
                    this.retryCount++;
                    if (this.retryCount < this.maxRetries) {
                        this.logger.info(`Waiting ${this.retryDelay}ms before the next attempt...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    } else {
                        vscode.window.showErrorMessage(`Failed to connect to the Java server on port ${this.serverPort} after multiple attempts.`);
                        this.isConnecting = false;
                        return;
                    }
                } else {
                    vscode.window.showErrorMessage(`Unexpected connection error: ${err.message}`);
                    this.isConnecting = false;
                    return;
                }
            }
        }
        this.isConnecting = false;
    }

    private attemptConnection(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.client.connect(this.serverPort, this.serverHost, () => {
                this.isConnected = true;
                this.retryCount = 0; // Reset count on connection
                vscode.window.showInformationMessage(`Connected to the Java server at ${this.serverHost}:${this.serverPort}`);
                this.logger.info(`Connected to the Java server at ${this.serverHost}:${this.serverPort}`);
                resolve();
            });

            this.client.on('error', (err) => {
                this.isConnected = false;
                reject(err);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                this.logger.info('Connection to the server closed');
                // Do not automatically reconnect here to avoid infinite loop
            });
        });
    }

    public async sendRequest(request: any): Promise<any> {
        if (!this.isConnected) {
            this.logger.info('Attempting to reconnect before sending the request...');
            await this.connect();
            if (!this.isConnected) {
                throw new Error(`Not connected to the server. Check if the Java server is running at ${this.serverHost}:${this.serverPort}.`);
            }
        }

        return new Promise((resolve, reject) => {
            this.logger.info(`Sending request: ${JSON.stringify(request)}`);
            this.client.write(JSON.stringify(request) + '\n');

            // Set a timeout for the response
            const timeout = setTimeout(() => {
                this.client.removeAllListeners('data');
                reject(new Error('Timeout: The server did not respond in a timely manner'));
            }, 30000); // 30 seconds timeout

            this.client.once('data', (data: { toString: () => string }) => {
                clearTimeout(timeout); // Clear timeout when response is received
                try {
                    const response = JSON.parse(data.toString());
                    this.logger.info(`Response received: ${JSON.stringify(response)}`);
                    resolve(response);
                } catch (e: any) {
                    reject(new Error(`Error processing response: ${e.message}`));
                }
            });

            this.client.on('error', (err) => {
                clearTimeout(timeout);
                this.logger.error(`Error sending request: ${err.message}`);
                this.isConnected = false;
                reject(err);
            });
        });
    }

    getServerHost(): string {
        return this.serverHost;
    }

    getServerPort(): number {
        return this.serverPort;
    }

    getHibernateVersion(): string {
        return this.hibernateVersion;
    }



    /**
     * Executes a query on the server
     * @param query The query to be executed
     * @param params Query parameters
     * @param isNative Flag indicating if it is a native SQL query (true) or JPQL (false)
     * @param config Additional configurations
     */
    public async executeQuery(
        query: string,
        params: any,
        isNative: boolean,
        config: any
    ): Promise<any> {
        const request = {
            command: 'executeQuery',
            query,
            params,
            isNative,
            dbConfig: config.dbConfig,
            entityLibPath: config.entityLibPath,
            entityPackages: config.entityPackages,
            projectScan: config.projectScan,
            hibernateVersion: config.hibernateVersion
        };

        return this.sendRequest(request);
    }

    public destroy() {
        this.client.destroy();
        this.isConnected = false;
        this.isConnecting = false;
        this.logger.info('Client destroyed');
    }
}