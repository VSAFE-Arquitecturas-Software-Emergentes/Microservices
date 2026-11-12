import { JsonRpcProvider, ContractFactory, Wallet, hexlify, randomBytes } from 'ethers';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const artifact = JSON.parse(
  await readFile(
    new URL('../artifacts/contracts/IncidentAudit.sol/IncidentAudit.json', import.meta.url),
    'utf8',
  ),
);
const rpc = process.env.BLOCKCHAIN_RPC_URL || 'http://127.0.0.1:8545';
const provider = new JsonRpcProvider(rpc);
const signer = process.env.BLOCKCHAIN_PRIVATE_KEY
  ? new Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider)
  : await provider.getSigner();
const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy(
  hexlify(randomBytes(32)),
);
await contract.waitForDeployment();
const result = {
  address: await contract.getAddress(),
  rpc,
  chainId: String((await provider.getNetwork()).chainId),
  deploymentId: await contract.deploymentId(),
};
await mkdir(path.join(root, '.local'), { recursive: true });
await writeFile(path.join(root, '.local', 'blockchain.json'), JSON.stringify(result, null, 2));
console.log('Contrato local desplegado:', result.address);
