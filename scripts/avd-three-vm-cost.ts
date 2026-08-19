export interface ThreeVmLabCostInput {
  billedHours: number;
  boundedDataGb: number;
  diskOperationsPerDisk: number;
}

export interface ThreeVmLabCostBreakdown {
  windowsComputeUsd: number;
  linuxComputeUsd: number;
  disksUsd: number;
  diskOperationsUsd: number;
  natGatewayUsd: number;
  publicIpUsd: number;
  natDataUsd: number;
  internetEgressUsd: number;
  totalUsd: number;
}

export const eastUsRetailRates = {
  windowsD4sV3Hourly: 0.376,
  linuxF1alsV7Hourly: 0.0605,
  e10Monthly: 9.6,
  e4Monthly: 2.4,
  diskOperationsPer10k: 0.002,
  natGatewayHourly: 0.045,
  publicIpv4Hourly: 0.005,
  natDataPerGb: 0.045,
  conservativeInternetEgressPerGb: 0.087,
  monthlyHours: 730,
} as const;

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function calculateThreeVmLabCost(
  input: ThreeVmLabCostInput,
): ThreeVmLabCostBreakdown {
  if (
    input.billedHours <= 0 ||
    input.boundedDataGb < 0 ||
    input.diskOperationsPerDisk < 0
  ) {
    throw new Error("Cost-model quantities must be non-negative.");
  }

  const rates = eastUsRetailRates;
  const windowsComputeUsd = input.billedHours * rates.windowsD4sV3Hourly;
  const linuxComputeUsd =
    input.billedHours * 2 * rates.linuxF1alsV7Hourly;
  const disksUsd =
    (input.billedHours / rates.monthlyHours) *
    (rates.e10Monthly + 2 * rates.e4Monthly);
  const diskOperationsUsd =
    3 *
    (input.diskOperationsPerDisk / 10_000) *
    rates.diskOperationsPer10k;
  const natGatewayUsd = input.billedHours * rates.natGatewayHourly;
  const publicIpUsd = input.billedHours * rates.publicIpv4Hourly;
  const natDataUsd = input.boundedDataGb * rates.natDataPerGb;
  const internetEgressUsd =
    input.boundedDataGb * rates.conservativeInternetEgressPerGb;

  return {
    windowsComputeUsd: round(windowsComputeUsd),
    linuxComputeUsd: round(linuxComputeUsd),
    disksUsd: round(disksUsd),
    diskOperationsUsd: round(diskOperationsUsd),
    natGatewayUsd: round(natGatewayUsd),
    publicIpUsd: round(publicIpUsd),
    natDataUsd: round(natDataUsd),
    internetEgressUsd: round(internetEgressUsd),
    totalUsd: round(
      windowsComputeUsd +
        linuxComputeUsd +
        disksUsd +
        diskOperationsUsd +
        natGatewayUsd +
        publicIpUsd +
        natDataUsd +
        internetEgressUsd,
    ),
  };
}
