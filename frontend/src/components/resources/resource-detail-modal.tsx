"use client";

import { useState, useEffect } from "react";
import {
  FileText,
  Eye,
  Save,
  Loader2,
  Globe,
  Lock,
  Sparkles,
  CheckCircle2,
  Circle,
  PauseCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resourcesApi, type Resource } from "@/lib/api/resources";
import { PDFViewer } from "./pdf-viewer";

interface ResourceDetailModalProps {
  resource: Resource;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResourceUpdated?: (resource: Resource) => void;
  onExtract?: (id: number) => void;
  extractionProgress?: number;
  isMyLibrary?: boolean;
}

export function ResourceDetailModal({
  resource,
  open,
  onOpenChange,
  onResourceUpdated,
  onExtract,
  extractionProgress,
  isMyLibrary = false,
}: ResourceDetailModalProps) {
  const [name, setName] = useState(resource.name);
  const [isPublic, setIsPublic] = useState(resource.is_public);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  // Reset state when resource changes
  useEffect(() => {
    setName(resource.name);
    setIsPublic(resource.is_public);
    setHasChanges(false);
  }, [resource]);

  // Fetch thumbnail
  useEffect(() => {
    if (open) {
      fetch(`/api/v1/resources/${resource.id}/thumbnail`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setThumbnailUrl(data?.url || null))
        .catch(() => setThumbnailUrl(null));
    }
  }, [resource.id, open]);

  // Track changes
  useEffect(() => {
    const nameChanged = name !== resource.name;
    const publicChanged = isPublic !== resource.is_public;
    setHasChanges(nameChanged || publicChanged);
  }, [name, isPublic, resource.name, resource.is_public]);

  const handleSave = async () => {
    if (!hasChanges) return;

    setIsSaving(true);
    try {
      const updates: { name?: string; is_public?: boolean } = {};
      if (name !== resource.name) updates.name = name;
      if (isPublic !== resource.is_public) updates.is_public = isPublic;

      const updatedResource = await resourcesApi.updateResource(
        resource.id,
        updates
      );

      setHasChanges(false);
      toast.success("Changes saved");

      if (onResourceUpdated) {
        onResourceUpdated(updatedResource);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewPdf = async () => {
    try {
      const url = await resourcesApi.getDownloadUrl(resource.id);
      setPdfUrl(url);
      setShowPdf(true);
    } catch (e) {
      console.error("Failed to get PDF URL:", e);
      toast.error("Failed to load PDF");
    }
  };

  const handleExtract = () => {
    if (onExtract) {
      onExtract(resource.id);
      toast.success("Extraction started");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getExtractionStatus = () => {
    const status = resource.extraction_status;
    const progressValue =
      extractionProgress ?? (status === "pending" ? 0 : undefined);

    // Check for paused state
    if (status === "failed") {
      return {
        icon: PauseCircle,
        color: "text-amber-500",
        bgColor: "bg-amber-50 dark:bg-amber-950/20",
        borderColor: "border-amber-200 dark:border-amber-800",
        label: "Paused",
        canExtract: true,
      };
    }

    switch (status) {
      case "completed":
        return {
          icon: CheckCircle2,
          color: "text-green-500",
          bgColor: "bg-green-50 dark:bg-green-950/20",
          borderColor: "border-green-200 dark:border-green-800",
          label: "Extracted",
          canExtract: false,
        };
      case "processing":
        return {
          icon: Loader2,
          color: "text-blue-500",
          bgColor: "bg-blue-50 dark:bg-blue-950/20",
          borderColor: "border-blue-200 dark:border-blue-800",
          label: "Extracting",
          spin: true,
          canExtract: false,
          showProgress: true,
          progress: progressValue,
        };
      case "pending":
        return {
          icon: Loader2,
          color: "text-blue-400",
          bgColor: "bg-blue-50 dark:bg-blue-950/20",
          borderColor: "border-blue-200 dark:border-blue-800",
          label: "Queued",
          spin: true,
          canExtract: false,
        };
      default:
        return {
          icon: Circle,
          color: "text-muted-foreground",
          bgColor: "bg-muted",
          borderColor: "border-muted",
          label: "Not extracted",
          canExtract: true,
        };
    }
  };

  const extractionStatus = getExtractionStatus();
  const StatusIcon = extractionStatus.icon;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Resource Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-4">
            {/* Thumbnail */}
            <div className="flex justify-center">
              <div className="w-40 h-52 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
                {thumbnailUrl ? (
                  <img
                    src={thumbnailUrl}
                    alt={resource.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FileText className="h-16 w-16 text-muted-foreground/50" />
                )}
              </div>
            </div>

            {/* Resource Info */}
            <div className="text-center text-sm text-muted-foreground">
              {resource.page_count} pages • {formatFileSize(resource.size_bytes)}
            </div>

            {/* Extraction Status */}
            {isMyLibrary && (
              <div
                className={`rounded-lg border p-3 ${extractionStatus.bgColor} ${extractionStatus.borderColor}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon
                      className={`h-5 w-5 ${extractionStatus.color} ${extractionStatus.spin ? "animate-spin" : ""}`}
                    />
                    <span className="font-medium text-sm">
                      {extractionStatus.label}
                    </span>
                  </div>
                  {extractionStatus.showProgress && extractionStatus.progress !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      {extractionStatus.progress}%
                    </span>
                  )}
                </div>
                {extractionStatus.showProgress && extractionStatus.progress !== undefined && (
                  <Progress value={extractionStatus.progress} className="h-1.5" />
                )}
              </div>
            )}

            {/* Name Input */}
            {isMyLibrary ? (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Resource name"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Name</Label>
                <p className="text-sm">{resource.name}</p>
              </div>
            )}

            {/* Public/Private Toggle */}
            {isMyLibrary && (
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="public">Visibility</Label>
                  <p className="text-sm text-muted-foreground">
                    {isPublic ? (
                      <span className="flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Public - visible to everyone
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Lock className="h-3 w-3" /> Private - only you can see
                      </span>
                    )}
                  </p>
                </div>
                <Switch
                  id="public"
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleViewPdf}
              >
                <Eye className="h-4 w-4 mr-2" />
                View PDF
              </Button>

              {isMyLibrary && extractionStatus.canExtract && (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleExtract}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {resource.extraction_status === "failed" ? "Resume" : "Extract"}
                </Button>
              )}

              {isMyLibrary && (
                <Button
                  className="flex-1"
                  onClick={handleSave}
                  disabled={!hasChanges || isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PDF Viewer */}
      {pdfUrl && (
        <PDFViewer
          url={pdfUrl}
          title={resource.name}
          open={showPdf}
          onOpenChange={setShowPdf}
        />
      )}
    </>
  );
}
