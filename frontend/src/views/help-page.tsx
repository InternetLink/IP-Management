"use client";

import type {ComponentType} from "react";
import {ArrowRightFromSquare, Book, Comment, LifeRing} from "@gravity-ui/icons";
import {Accordion, Card, Link} from "@heroui/react";

type HelpLink = { description: string; href: string; icon: ComponentType<{className?: string}>; title: string };

const HELP_LINKS: readonly HelpLink[] = [
  { description: "Learn about CIDR notation, subnet management, and geofeed RFC 8805.", href: "#", icon: Book, title: "Documentation" },
  { description: "Join the community to discuss IP management best practices.", href: "#", icon: Comment, title: "Community" },
  { description: "Get help from our support team for complex networking questions.", href: "#", icon: LifeRing, title: "Contact Support" },
];

const FAQS = [
  { question: "What is RFC 8805 Geofeed?", answer: "RFC 8805 defines a format for publishing IP geolocation data. It allows network operators to declare the geographic location of their IP prefixes in a standardized CSV format that can be consumed by geolocation databases like MaxMind and IP2Location." },
  { question: "How do I add a new IP block?", answer: "Navigate to IP Blocks, click 'Add IP Block', enter the CIDR notation, select the RIR, and provide a description. The system will automatically calculate the IP range and detect any conflicts with existing blocks." },
  { question: "What does subnet utilization mean?", answer: "Subnet utilization shows the percentage of IP addresses within a subnet that have been allocated. Green (0-60%) indicates healthy usage, yellow (60-85%) indicates growing usage, and red (85-100%) indicates the subnet is nearly full." },
  { question: "How do I generate a geofeed file?", answer: "Go to the Geofeed page. Your entries are automatically formatted into RFC 8805 format in the live preview panel. You can copy the output or download it as a CSV file." },
];

export function HelpPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 pb-10 pt-4">
      <p className="text-muted text-sm">Find answers about IPAM and Geofeed management.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {HELP_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Card key={link.title} className="rounded-2xl">
              <Card.Header>
                <div className="bg-accent-soft text-accent flex size-10 items-center justify-center rounded-xl"><Icon className="size-5" /></div>
                <Card.Title className="text-base">{link.title}</Card.Title>
                <Card.Description>{link.description}</Card.Description>
              </Card.Header>
              <Card.Footer><Link className="text-accent inline-flex items-center gap-1 text-sm" href={link.href}>Open<ArrowRightFromSquare className="size-3.5" /></Link></Card.Footer>
            </Card>
          );
        })}
      </div>
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
