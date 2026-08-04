"use client";

import { isExternalAboutLink, type AboutLink } from "@rbrasier/domain";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/trpc/client";
import { ABOUT_LINK_ICON_COMPONENTS } from "./about-link-icons";

// Inlined at build time from the repo-root VERSION file (see next.config.ts).
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";

function AboutLinkButton({ link }: { link: AboutLink }) {
  const Icon = ABOUT_LINK_ICON_COMPONENTS[link.icon];
  const isExternal = isExternalAboutLink(link.url);

  return (
    <a
      href={link.url}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex items-center gap-2 rounded-[8px] border border-[#dedad2] bg-white px-3 py-2 text-[13px] font-medium text-[#1a1814] transition-colors hover:border-[#3a5fd9] hover:bg-[#eef1fc] hover:text-[#3a5fd9]"
    >
      <Icon className="h-[14px] w-[14px] shrink-0 text-[#6d6a65]" />
      {link.label}
    </a>
  );
}

export function AboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aboutLinksQuery = trpc.settings.getAboutLinks.useQuery(undefined, { enabled: open });
  const links = aboutLinksQuery.data?.links ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>About Wayfinder</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex items-center gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#3a5fd9] text-[18px] font-bold text-white">
              W
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[#1a1814]">Wayfinder</p>
              <p className="font-mono text-[12px] text-[#6d6a65]">Version {APP_VERSION}</p>
            </div>
          </div>

          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Wayfinder is an AI-guided workflow agent for document-heavy processes. It walks you
            through a defined process step by step, gathering what it needs, producing the documents
            the process calls for, and recording confidence and an audit trail as it goes.
          </p>

          {links.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-[#dedad2] pt-3">
              {links.map((link) => (
                <AboutLinkButton key={`${link.label}-${link.url}`} link={link} />
              ))}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
