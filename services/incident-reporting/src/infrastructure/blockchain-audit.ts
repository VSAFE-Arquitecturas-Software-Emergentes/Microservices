import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { JsonRpcProvider, Contract, Wallet } from 'ethers';
import { workspacePath } from '@vsafe/platform';
import { Problem } from '@vsafe/contracts';
import { AuditPort } from '../application/report-service';
import { commitment, columns, incident } from './pg-reports';
const abi = [
  'function deploymentId() view returns(bytes32)',
  'function commitments(bytes32) view returns(bytes32)',
  'function anchor(bytes32,bytes32)',
];
export class BlockchainAudit implements AuditPort {
  private busy = false;
  private timer?: NodeJS.Timeout;
  constructor(private readonly pool: Pool) {}
  async contract(write = false) {
    let local: any = {};
    try {
      local = JSON.parse(await readFile(workspacePath('.local', 'blockchain.json'), 'utf8'));
    } catch {}
    const address = process.env.BLOCKCHAIN_CONTRACT_ADDRESS || local.address;
    if (!address) throw new Error('CHAIN_NOT_CONFIGURED');
    const provider = new JsonRpcProvider(
      process.env.BLOCKCHAIN_RPC_URL || local.rpc || 'http://127.0.0.1:8545',
    );
    const signer = write
      ? process.env.BLOCKCHAIN_PRIVATE_KEY
        ? new Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider)
        : await provider.getSigner()
      : provider;
    return new Contract(address, abi, signer);
  }
  start() {
    this.timer = setInterval(() => void this.tick(), 3000);
    this.timer.unref();
    void this.tick();
  }
  stop() {
    clearInterval(this.timer);
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const contract = await this.contract(true);
      const instance = await contract.deploymentId();
      const rows = await this.pool.query(
        'SELECT * FROM audit_records WHERE tx_hash IS NULL OR chain_instance IS DISTINCT FROM $1 ORDER BY version,id LIMIT 10',
        [instance],
      );
      for (const r of rows.rows) {
        try {
          const tx = await contract.anchor(r.reference, r.commitment);
          const receipt = await tx.wait();
          await this.pool.query(
            'UPDATE audit_records SET tx_hash=$2,chain_instance=$3,anchored_at=now() WHERE id=$1',
            [r.id, receipt.hash, instance],
          );
        } catch {
          await this.pool.query('UPDATE audit_records SET attempts=attempts+1 WHERE id=$1', [r.id]);
        }
      }
    } catch {
    } finally {
      this.busy = false;
    }
  }
  async verify(owner: string, id: string) {
    const row = await this.pool.query(
      `SELECT ${columns} FROM incidents WHERE id=$1 AND owner_ref=$2`,
      [id, owner],
    );
    if (!row.rowCount) throw new Problem(404, 'REPORT_NOT_FOUND');
    const current = incident(row.rows[0]);
    const records = await this.pool.query(
      'SELECT * FROM audit_records WHERE incident_id=$1 ORDER BY version',
      [id],
    );
    const result = [];
    for (const r of records.rows) {
      let status = 'PENDING';
      try {
        const contract = await this.contract();
        const instance = await contract.deploymentId();
        if (r.tx_hash && r.chain_instance === instance) {
          const payload = r.version === current.version ? current : r.payload;
          status =
            (await contract.commitments(r.reference)) === commitment(r.salt, payload)
              ? 'VERIFIED'
              : 'MISMATCH';
        } else if (r.tx_hash) status = 'NETWORK_RESET';
      } catch {
        status = 'UNAVAILABLE';
      }
      result.push({
        version: r.version,
        status,
        transactionHash: r.tx_hash,
        anchoredAt: r.anchored_at,
      });
    }
    return {
      incidentId: id,
      versions: result,
      scope: 'RECORD_INTEGRITY_ONLY',
      developmentNetwork: !process.env.BLOCKCHAIN_PRIVATE_KEY,
    };
  }
}
