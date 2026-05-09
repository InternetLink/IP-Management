import type {Metadata} from "next";
import type {ReactNode} from "react";

import {Toast} from "@heroui/react";

import {I18nProvider} from "../i18n";

import "./globals.css";

export const metadata: Metadata = {
  description: "IP Address Management & Geofeed Generator — Manage hierarchical prefixes, IP pools, allocations, and RFC 8805 geofeed data.",
  title: "IPAM — IP Address Management",
};

export default function RootLayout({children}: {children: ReactNode}) {
  return (
    <html suppressHydrationWarning className="bg-background text-foreground" lang="en">
      <body className="font-sans antialiased">
        <I18nProvider>
          {children}
        </I18nProvider>
        <Toast.Provider placement="bottom" />
      </body>
    </html>
  );
}
