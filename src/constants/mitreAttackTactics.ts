import type { LabelDefinition } from '@workers/types';

interface MitreAttackLabelTemplate {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_TIMESTAMP = 0;

const MITRE_ATTACK_LABEL_TEMPLATES: readonly MitreAttackLabelTemplate[] = [
  { id: 'mitre-ta0043-reconnaissance', name: 'Reconnaissance', color: '#64748b' },
  { id: 'mitre-ta0042-resource-development', name: 'Resource Development', color: '#0f766e' },
  { id: 'mitre-ta0001-initial-access', name: 'Initial Access', color: '#b45309' },
  { id: 'mitre-ta0002-execution', name: 'Execution', color: '#c2410c' },
  { id: 'mitre-ta0003-persistence', name: 'Persistence', color: '#7c3aed' },
  { id: 'mitre-ta0004-privilege-escalation', name: 'Privilege Escalation', color: '#be123c' },
  { id: 'mitre-ta0005-defense-evasion', name: 'Defense Evasion', color: '#1d4ed8' },
  { id: 'mitre-ta0006-credential-access', name: 'Credential Access', color: '#b91c1c' },
  { id: 'mitre-ta0007-discovery', name: 'Discovery', color: '#0891b2' },
  { id: 'mitre-ta0008-lateral-movement', name: 'Lateral Movement', color: '#0369a1' },
  { id: 'mitre-ta0009-collection', name: 'Collection', color: '#65a30d' },
  { id: 'mitre-ta0011-command-and-control', name: 'Command and Control', color: '#7c2d12' },
  { id: 'mitre-ta0010-exfiltration', name: 'Exfiltration', color: '#db2777' },
  { id: 'mitre-ta0040-impact', name: 'Impact', color: '#991b1b' }
];

export const createDefaultMitreAttackTacticLabels = (): LabelDefinition[] =>
  MITRE_ATTACK_LABEL_TEMPLATES.map((template) => ({
    ...template,
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP
  }));
