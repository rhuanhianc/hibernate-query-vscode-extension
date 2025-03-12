// __mocks__/services/telemetryService.ts

export class TelemetryService {
    private static instance: TelemetryService;
  
    private constructor() {}
  
    public static getInstance(): TelemetryService {
      if (!TelemetryService.instance) {
        TelemetryService.instance = new TelemetryService();
      }
      return TelemetryService.instance;
    }
  
    public sendQueryExecutedEvent = jest.fn();
  }