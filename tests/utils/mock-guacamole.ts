/**
 * Mock remote-desktop gateway.
 *
 * Stands in for Apache Guacamole. It records ephemeral users and connections
 * so tests can assert that brokering happened server-side, and it never
 * exposes RDP credentials or the VM's private address to a caller.
 */

export interface BrokeredConnection {
  id: string;
  sessionId: string;
  vmId: string;
  ephemeralUsername: string;
  terminated: boolean;
}

export interface MockGateway {
  connections: Map<string, BrokeredConnection>;
  failNext: boolean;
  /** Session ids whose connection was revoked, in order. */
  terminated: string[];
  reset(): void;
  createConnection(input: { sessionId: string; vmId: string; privateIp: string }): Promise<{
    id: string;
    sessionId: string;
    vmId: string;
    state: "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
    tunnelUrl: string;
  }>;
  getConnectionStatus(sessionId: string): Promise<BrokeredConnection | null>;
  terminateConnection(sessionId: string): Promise<BrokeredConnection | null>;
}

export function createMockGateway(): MockGateway {
  const gateway: MockGateway = {
    connections: new Map(),
    failNext: false,
    terminated: [],
    reset() {
      gateway.connections.clear();
      gateway.terminated.length = 0;
      gateway.failNext = false;
    },
    async createConnection({ sessionId, vmId }) {
      if (gateway.failNext) {
        gateway.failNext = false;
        throw new Error("GATEWAY_UNAVAILABLE");
      }
      const connection: BrokeredConnection = {
        id: `gc-${gateway.connections.size + 1}`,
        sessionId,
        vmId,
        ephemeralUsername: `st-${sessionId}`,
        terminated: false,
      };
      gateway.connections.set(sessionId, connection);
      return {
        id: connection.id,
        sessionId,
        vmId,
        state: "CONNECTING",
        tunnelUrl: "https://gateway.test.invalid/#/client/token",
      };
    },
    async getConnectionStatus(sessionId) {
      return gateway.connections.get(sessionId) ?? null;
    },
    async terminateConnection(sessionId) {
      const connection = gateway.connections.get(sessionId);
      gateway.terminated.push(sessionId);
      if (!connection) return null;
      connection.terminated = true;
      return connection;
    },
  };
  return gateway;
}