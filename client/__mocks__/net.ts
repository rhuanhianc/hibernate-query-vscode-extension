// Mock para o módulo net

// Criando uma classe Socket mock que imita a interface do Socket do Node.js
class Socket {
    private listeners: Record<string, Function[]> = {
      'data': [],
      'error': [],
      'close': [],
      'connect': []
    };
  
    constructor() {
      // Inicializa o objeto com métodos mock
    }
  
    // Mock para método connect
    connect(port: number, host: string, callback?: Function): Socket {
      if (callback) {
        callback();
      }
      return this;
    }
  
    // Mock para método on
    on(event: string, listener: Function): Socket {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(listener);
      return this;
    }
  
    // Mock para método once
    once(event: string, listener: Function): Socket {
      return this.on(event, listener);
    }
  
    // Mock para método removeListener
    removeListener(event: string, listener: Function): Socket {
      if (this.listeners[event]) {
        const index = this.listeners[event].indexOf(listener);
        if (index !== -1) {
          this.listeners[event].splice(index, 1);
        }
      }
      return this;
    }
  
    // Mock para método removeAllListeners
    removeAllListeners(event?: string): Socket {
      if (event) {
        if (this.listeners[event]) {
          this.listeners[event] = [];
        }
      } else {
        // Limpa todos os listeners
        for (const key in this.listeners) {
          this.listeners[key] = [];
        }
      }
      return this;
    }
  
    // Mock para método write
    write(data: string | Buffer, callback?: (err?: Error) => void): boolean {
      if (callback) {
        callback();
      }
      return true;
    }
  
    // Mock para método end
    end(callback?: () => void): Socket {
      if (callback) {
        callback();
      }
      return this;
    }
  
    // Mock para método destroy
    destroy(): Socket {
      return this;
    }
  
    // Método para simular recebimento de dados
    simulateData(data: string | Buffer): void {
      if (this.listeners['data']) {
        for (const listener of this.listeners['data']) {
          listener(Buffer.from(data.toString()));
        }
      }
    }
  
    // Método para simular erro
    simulateError(error: Error): void {
      if (this.listeners['error']) {
        for (const listener of this.listeners['error']) {
          listener(error);
        }
      }
    }
  
    // Método para simular fechamento de conexão
    simulateClose(): void {
      if (this.listeners['close']) {
        for (const listener of this.listeners['close']) {
          listener();
        }
      }
    }
  }
  
  export { Socket };