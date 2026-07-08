// This file extends the AdapterConfig type from "@iobroker/types"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
        useMasterValve: boolean;
        masterValveStateId: string;
        masterValveDelay: number;
        useRainSensor: boolean;
        rainSensorStateId: string;
        zones: {
        zoneName: string;
        valveStateId: string;
        }[];
}
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};