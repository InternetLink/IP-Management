"use client";

import {Accordion} from "@heroui/react";

const FAQS = [
  { question: "What is RFC 8805 Geofeed?", answer: "RFC 8805 defines a format for publishing IP geolocation data. It allows network operators to declare the geographic location of their IP prefixes in a standardized CSV format that can be consumed by geolocation databases like MaxMind and IP2Location." },
  { question: "How do I add a new IP prefix?", answer: "Navigate to IP Prefixes, click 'Add Prefix', enter the CIDR notation, and provide a description. The system will automatically calculate the IP range and detect any conflicts with existing prefixes." },
  { question: "What does subnet utilization mean?", answer: "Subnet utilization shows the percentage of IP addresses within a prefix that have been allocated. Green (0-60%) indicates healthy usage, yellow (60-85%) indicates growing usage, and red (85-100%) indicates the prefix is nearly full." },
  { question: "How do I generate a geofeed file?", answer: "Go to the Geofeed page. Your entries are automatically formatted into RFC 8805 format. You can download the output as a CSV file via the public endpoint, or use the export button in the UI." },
  { question: "How is authentication handled?", answer: "The first admin account is created by an operator via the CLI command 'npm run auth:bootstrap'. After that, users log in through the browser with username and password. Sessions are managed with HttpOnly cookies and CSRF protection." },
];

export function HelpPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Find answers about IPAM and Geofeed management.</p>
      <section className="flex flex-col gap-3">
        <h2 className="text-foreground text-base font-semibold">Frequently Asked Questions</h2>
        <Accordion className="w-full">
          {FAQS.map((faq, index) => (
            <Accordion.Item key={faq.question} id={`faq-${index}`}>
              <Accordion.Heading><Accordion.Trigger>{faq.question}<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading>
              <Accordion.Panel><Accordion.Body className="text-muted text-sm">{faq.answer}</Accordion.Body></Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
