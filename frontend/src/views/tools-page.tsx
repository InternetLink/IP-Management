"use client";

import {Card, Input, Label, TextField} from "@heroui/react";
import {Segment} from "@heroui-pro/react";
import {useMemo, useState} from "react";

import {getSubnetInfo, parseCidr, splitCidr, validateCidr} from "../lib/cidr";
import type {SplitCidrResult, SubnetInfo} from "../lib/cidr";

function assertNever(value: never): never {
  throw new Error(`Unexpected split result: ${String(value)}`);
}

type ToolTab = "calculator" | "splitter";

export function ToolsPage() {
  const [activeTab, setActiveTab] = useState<ToolTab>("calculator");

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Network tools and CIDR calculators.</p>
       <Segment aria-label="Tools" selectedKey={activeTab} size="sm" onSelectionChange={(key: unknown) => {
         const nextTab = String(key);
         if (nextTab === "calculator" || nextTab === "splitter") setActiveTab(nextTab);
       }}>
         <Segment.Item id="calculator">CIDR Calculator</Segment.Item>
         <Segment.Item id="splitter">Subnet Splitter</Segment.Item>
       </Segment>

       {activeTab === "calculator" && <CIDRCalculator />}
       {activeTab === "splitter" && <SubnetSplitter />}
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
            <InfoCell label={info.version === 6 ? "Last Address" : "Broadcast"} value={info.broadcastAddress} mono />
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

  const cidrValidation = useMemo(() => validateCidr(cidr), [cidr]);
  const prefixError = useMemo(() => {
    if (!cidrValidation.valid) return null;
    if (!newPrefix.trim()) return "Enter a new prefix length.";

    const prefix = Number(newPrefix);
    if (!Number.isInteger(prefix)) return "New prefix length must be a whole number.";

    const parsed = parseCidr(cidr);
    if (!parsed) return "Enter a valid CIDR.";
    const maxPrefix = parsed.version === 4 ? 32 : 128;
    if (prefix < parsed.prefix || prefix > maxPrefix) {
      return `New prefix length must be between ${parsed.prefix} and ${maxPrefix}.`;
    }
    return null;
  }, [cidr, cidrValidation.valid, newPrefix]);
  const inputError = cidrValidation.valid ? prefixError : cidrValidation.error ?? "Enter a valid CIDR.";
  const splitResult = useMemo<SplitCidrResult>(() => {
    if (inputError) return {kind: "ok", subnets: []};
    return splitCidr(cidr, Number(newPrefix));
  }, [cidr, inputError, newPrefix]);
  let results: readonly string[] = [];
  let overLimitMessage: string | null = null;

  switch (splitResult.kind) {
    case "ok":
      results = splitResult.subnets;
      break;
    case "over-limit":
      overLimitMessage = `This split would produce ${splitResult.count.toLocaleString()} subnets, which exceeds the ${splitResult.limit.toLocaleString()} limit. Choose a smaller prefix length.`;
      break;
    default:
      assertNever(splitResult);
  }

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
            <Input fullWidth className="font-mono" type="number" min={0} max={cidr.includes(":") ? 128 : 32} value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} />
          </TextField>
        </div>

        {inputError && <p role="alert" className="text-danger text-sm">{inputError}</p>}
        {overLimitMessage && <p role="alert" className="text-danger text-sm">{overLimitMessage}</p>}
        {results.length > 0 && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <span className="text-foreground text-sm font-medium">{results.length} subnets:</span>
            <div className="bg-default-100 rounded-lg p-3 max-h-[300px] overflow-auto">
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {results.map((result) => (
                  <li key={result} className="font-mono text-xs text-foreground">{result}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
