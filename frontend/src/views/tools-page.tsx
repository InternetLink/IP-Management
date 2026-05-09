"use client";

import {Card, Input, Label, TextField} from "@heroui/react";
import {Segment} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {getSubnetInfo, splitCidr, validateCidr} from "../lib/cidr";
import type {SubnetInfo} from "../lib/cidr";

export function ToolsPage() {
  const [activeTab, setActiveTab] = useState<string>("calculator");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Network tools and CIDR calculators.</p>
      <Segment aria-label="Tools" selectedKey={activeTab} size="sm" onSelectionChange={(key) => setActiveTab(String(key))}>
        <Segment.Item id="calculator">CIDR Calculator</Segment.Item>
        <Segment.Item id="splitter">Subnet Splitter</Segment.Item>
        <Segment.Item id="lookup">IP Lookup</Segment.Item>
      </Segment>

      {activeTab === "calculator" && <CIDRCalculator />}
      {activeTab === "splitter" && <SubnetSplitter />}
      {activeTab === "lookup" && <IPLookup />}
    </div>
  );
}

function CIDRCalculator() {
  const [cidr, setCidr] = useState("103.152.220.0/22");
  const validation = useMemo(() => validateCidr(cidr), [cidr]);
  const info = useMemo<SubnetInfo | null>(() => validation.valid ? getSubnetInfo(cidr) : null, [cidr, validation]);

  return (
    <Card className="rounded-2xl">
      <Card.Header><Card.Title className="text-base">CIDR Calculator</Card.Title><Card.Description>Enter a CIDR notation to calculate subnet details.</Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <TextField name="cidr-input" isInvalid={!!cidr && !validation.valid}>
          <Label>CIDR Notation</Label>
          <Input fullWidth className="font-mono" placeholder="e.g. 10.0.0.0/24" value={cidr} onChange={(e) => setCidr(e.target.value)} />
          {cidr && !validation.valid && <span className="text-danger text-xs mt-1">{validation.error}</span>}
        </TextField>

        {info && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <InfoCell label="Network" value={info.networkAddress} mono />
            <InfoCell label="Broadcast" value={info.broadcastAddress} mono />
            <InfoCell label="Subnet Mask" value={info.subnetMask} mono />
            <InfoCell label="Wildcard Mask" value={info.wildcardMask} mono />
            <InfoCell label="First Usable" value={info.firstUsable} mono />
            <InfoCell label="Last Usable" value={info.lastUsable} mono />
            <InfoCell label="Total Hosts" value={info.totalHosts.toLocaleString()} />
            <InfoCell label="Usable Hosts" value={info.usableHosts.toLocaleString()} />
            {info.ipClass && <InfoCell label="IP Class" value={info.ipClass} />}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

function SubnetSplitter() {
  const [cidr, setCidr] = useState("10.0.0.0/22");
  const [newPrefix, setNewPrefix] = useState("24");

  const results = useMemo(() => {
    const v = validateCidr(cidr);
    if (!v.valid) return [];
    const p = parseInt(newPrefix, 10);
    if (isNaN(p)) return [];
    return splitCidr(cidr, p);
  }, [cidr, newPrefix]);

  return (
    <Card className="rounded-2xl">
      <Card.Header><Card.Title className="text-base">Subnet Splitter</Card.Title><Card.Description>Split a CIDR into smaller subnets.</Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <TextField name="split-cidr">
            <Label>Source CIDR</Label>
            <Input fullWidth className="font-mono" value={cidr} onChange={(e) => setCidr(e.target.value)} />
          </TextField>
          <TextField name="split-prefix">
            <Label>New Prefix Length</Label>
            <Input fullWidth className="font-mono" type="number" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} />
          </TextField>
        </div>

        {results.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-foreground text-sm font-medium">{results.length} subnets:</span>
            <div className="bg-default-100 rounded-lg p-3 max-h-[300px] overflow-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {results.map((r, i) => (
                  <span key={i} className="font-mono text-xs text-foreground">{r}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

function IPLookup() {
  const [ip, setIp] = useState("");

  return (
    <Card className="rounded-2xl">
      <Card.Header><Card.Title className="text-base">IP Lookup</Card.Title><Card.Description>Search for an IP address in your managed space.</Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <TextField name="ip-lookup">
          <Label>IP Address</Label>
          <Input fullWidth className="font-mono" placeholder="e.g. 103.152.220.10" value={ip} onChange={(e) => setIp(e.target.value)} />
        </TextField>
        {!ip && <p className="text-muted text-sm">Enter an IP address to search your managed prefixes and allocations.</p>}
      </Card.Content>
    </Card>
  );
}

function InfoCell({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <div className="bg-default-100 rounded-lg p-3 flex flex-col gap-1">
      <span className="text-muted text-xs">{label}</span>
      <span className={`text-foreground text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
