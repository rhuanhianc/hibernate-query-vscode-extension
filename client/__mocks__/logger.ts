// __mocks__/utils/logger.ts

export class Logger {
    private static instance: Logger;
  
    private constructor() {}
  
    public static getInstance(): Logger {
      if (!Logger.instance) {
        Logger.instance = new Logger();
      }
      return Logger.instance;
    }
  
    public info = jest.fn();
    public error = jest.fn();
    public warn = jest.fn();
    public debug = jest.fn();
  }