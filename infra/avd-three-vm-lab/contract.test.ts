import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const directory = path.dirname(new URL(import.meta.url).pathname);
const controlPlane = fs.readFileSync(
  path.join(directory, "control-plane.bicep"),
  "utf8",
);
const compute = fs.readFileSync(
  path.join(directory, "compute.bicep"),
  "utf8",
);

describe("three-VM AVD lab topology", () => {
  it("keeps every VM NIC private behind one shared NAT boundary", () => {
    expect(controlPlane.match(/Microsoft\.Network\/publicIPAddresses/g)).toHaveLength(
      1,
    );
    expect(controlPlane.match(/Microsoft\.Network\/natGateways/g)).toHaveLength(
      1,
    );
    expect(controlPlane.match(/defaultOutboundAccess: false/g)).toHaveLength(2);
    expect(compute).not.toContain("publicIPAddress");
    expect(compute).not.toContain("bastion");
  });

  it("defines one Windows AVD host and exactly two Ubuntu auxiliaries", () => {
    expect(compute).toContain("vmSize: 'Standard_D2s_v3'");
    expect(compute).toContain("vmSize: 'Standard_F1als_v7'");
    expect(compute).toContain("for index in range(0, 2)");
    expect(compute).toContain("offer: 'ubuntu-24_04-lts'");
    expect(compute).toContain("licenseType: 'Windows_Client'");
  });

  it("limits auxiliary inbound traffic to the fixed private health path", () => {
    expect(controlPlane).toContain("name: 'AllowHealthFromSessionHost'");
    expect(controlPlane).toContain("destinationPortRange: '8080'");
    expect(controlPlane).toContain("sourceAddressPrefix: '10.89.1.0/24'");
    expect(controlPlane).toContain("name: 'DenyOtherVnetInbound'");
  });

  it("renders cloud-init loop values through explicit placeholders", () => {
    expect(compute).toContain("'__RUN_MARKER__', runMarker");
    expect(compute).toContain("'__NODE_NUMBER__'");
    expect(compute).toContain("'__IP_SUFFIX__'");
    expect(compute).not.toContain("10.89.2.${index + 4}");
  });
});
