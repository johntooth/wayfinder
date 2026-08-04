"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Info } from "lucide-react";
import { helpMenuAboutLinks, isExternalAboutLink } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";
import { AboutModal } from "./about-modal";
import { ABOUT_LINK_ICON_COMPONENTS } from "./about-link-icons";

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const aboutLinksQuery = trpc.settings.getAboutLinks.useQuery();
  // Only entries an admin flagged for the menu; the rest live on the About modal.
  const menuLinks = aboutLinksQuery.data ? helpMenuAboutLinks(aboutLinksQuery.data) : [];

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <div ref={menuRef} className="fixed right-3 top-3 z-30">
        <button
          type="button"
          aria-label="Help"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((previous) => !previous)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-[#dedad2] bg-white text-[#5a5650] shadow-[0_1px_3px_rgba(0,0,0,.06)] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
        >
          <HelpCircle className="h-4 w-4" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 w-52 rounded-[9px] border border-[#dedad2] bg-white py-1 shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setAboutOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
            >
              <Info className="h-[14px] w-[14px] shrink-0 text-[#5a5650]" />
              About
            </button>

            {menuLinks.map((link) => {
              const Icon = ABOUT_LINK_ICON_COMPONENTS[link.icon];
              const isExternal = isExternalAboutLink(link.url);
              return (
                <a
                  key={`${link.label}-${link.url}`}
                  role="menuitem"
                  href={link.url}
                  {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#1a1814] hover:bg-[#efede8]"
                >
                  <Icon className="h-[14px] w-[14px] shrink-0 text-[#5a5650]" />
                  {link.label}
                </a>
              );
            })}
          </div>
        )}
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
