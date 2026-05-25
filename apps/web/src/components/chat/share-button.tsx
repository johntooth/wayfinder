"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ShareButtonProps {
  label: string;
  url: string;
  toastMessage: string;
}

export function ShareButton({ label, url, toastMessage }: ShareButtonProps) {
  const handleShare = async () => {
    await navigator.clipboard.writeText(url);
    toast.success(toastMessage);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleShare}>
      {label}
    </Button>
  );
}
