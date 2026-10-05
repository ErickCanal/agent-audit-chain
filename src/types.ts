export interface AuditEvent {
  id: string;
  tenantId: string;
  actor: {
    type: 'agent' | 'user' | 'system';
    id: string;
  };
  action: {
    verb: string;
    resource: string;
    outcome: 'allowed' | 'denied';
  };
  payload: {
    digest: string;
    redactionLevel: 'none' | 'partial' | 'full';
  };
  timestamp: string;
  prevHash: string;
  hash: string;
}
