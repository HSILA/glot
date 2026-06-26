"use client";

import {
  FileText,
  MoreVertical,
  Sparkles,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  CheckCircle2,
  Circle,
  PauseCircle,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { type Resource } from "@/lib/api/resources";
import { ResourceDetailModal } from "./resource-detail-modal";

interface ResourceCardProps {
  resource: Resource;
  viewMode?: "grid" | "list";
  isMyLibrary?: boolean;
  onExtract?: (id: number) => void;
  onDelete?: (id: number) => void;
  onToggleVisibility?: (id: number, isPublic: boolean) => void;
  onAddToLibrary?: (id: number, name: string) => void;
  onResourceUpdated?: (resource: Resource) => void;
  extractionProgress?: number;
}

export function ResourceCard({
  resource,
  viewMode = "grid",
  isMyLibrary = false,
  onExtract,
  onDelete,
  onToggleVisibility,
  onAddToLibrary,
  onResourceUpdated,
  extractionProgress,
}: ResourceCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const handleCardClick = () => {
    setShowDetail(true);
  };

  const handleResourceUpdated = (updated: Resource) => {
    // Notify parent and also update visibility if changed
    if (onResourceUpdated) {
      onResourceUpdated(updated);
    }
    if (onToggleVisibility && updated.is_public !== resource.is_public) {
      onToggleVisibility(updated.id, updated.is_public);
    }
  };

  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  useEffect(() => {
    // Only fetch for grid view to save bandwidth
    if (viewMode === "grid") {
      fetch(`/api/v1/resources/${resource.id}/thumbnail`, {
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.url) setThumbnailUrl(data.url);
        })
        .catch(() => {}); // Ignore errors
    }
  }, [resource.id, viewMode]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Interrupted/stale extraction (or hard failure): backend asks us to offer Resume.
  const isInterrupted =
    resource.extraction_problem === true || resource.extraction_status === "failed";

  const canExtract =
    isMyLibrary &&
    (resource.extraction_status === "none" ||
      isInterrupted ||
      resource.can_resume_extraction === true);

  // Only spin/show progress for live extractions, not interrupted ones.
  const isExtracting =
    !isInterrupted &&
    (resource.extraction_status === "pending" ||
      resource.extraction_status === "processing");
  const progressValue = extractionProgress ?? (resource.extraction_status === "pending" ? 0 : undefined);

  // Status indicator config
  const getStatusConfig = () => {
    // Interrupted/stale/failed extraction shows an amber warning + Resume.
    if (isInterrupted) {
      return {
        icon: PauseCircle,
        color: "text-amber-500",
        borderColor: "hover:border-amber-500/50",
        label: "Interrupted",
      };
    }

    switch (resource.extraction_status) {
      case "completed":
        return {
          icon: CheckCircle2,
          color: "text-green-500",
          borderColor: "hover:border-green-500/50",
          label: "Extracted",
        };
      case "processing":
        return {
          icon: Loader2,
          color: "text-blue-500",
          borderColor: "hover:border-blue-500/50",
          label: "Extracting",
          spin: true,
        };
      case "pending":
        return {
          icon: Loader2,
          color: "text-blue-400",
          borderColor: "hover:border-blue-400/50",
          label: "Queued",
          spin: true,
        };
      default:
        return {
          icon: Circle,
          color: "text-muted-foreground/40",
          borderColor: "hover:border-muted-foreground/20",
          label: "Not extracted",
        };
    }
  };

  const statusConfig = getStatusConfig();
  const StatusIcon = statusConfig.icon;

  if (viewMode === "list") {
    return (
      <TooltipProvider>
        <Card 
          onClick={handleCardClick} 
          className={`overflow-hidden cursor-pointer hover:shadow-md transition-all border-2 ${statusConfig.borderColor}`}
        >
          <div className="flex gap-4 p-4">
            {/* Thumbnail placeholder */}
            <div className="w-16 h-24 bg-muted rounded-md flex items-center justify-center flex-shrink-0">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif font-semibold line-clamp-1">
                    {resource.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {resource.page_count} pages • {formatSize(resource.size_bytes)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {resource.is_public && (
                    <Badge variant="outline" className="text-xs">
                      Public
                    </Badge>
                  )}
                </div>
              </div>

              {/* Progress bar for processing */}
              {isExtracting && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {resource.extraction_status === "pending" ? "Queued..." : "Extracting..."}
                    </span>
                    {progressValue !== undefined && <span>{progressValue}%</span>}
                  </div>
                  <Progress value={progressValue ?? 0} className="h-1.5" />
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between mt-3">
                <div className="flex gap-2">
                  {isMyLibrary && canExtract && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer transition-all hover:scale-105 hover:shadow-lg hover:shadow-primary/50 hover:brightness-110"
                      onClick={(e) => {
                        e.stopPropagation();
                        onExtract?.(resource.id);
                      }}
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      {isInterrupted ? "Resume" : "Extract"}
                    </Button>
                  )}
                  {!isMyLibrary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToLibrary?.(resource.id, resource.name);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add to Library
                    </Button>
                  )}
                </div>

                {isMyLibrary && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {resource.is_owner && (
                        <DropdownMenuItem
                          onClick={() =>
                            onToggleVisibility?.(resource.id, !resource.is_public)
                          }
                        >
                          {resource.is_public ? (
                            <>
                              <EyeOff className="h-4 w-4 mr-2" />
                              Make Private
                            </>
                          ) : (
                            <>
                              <Eye className="h-4 w-4 mr-2" />
                              Make Public
                            </>
                          )}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete?.(resource.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          </div>
        </Card>
        <ResourceDetailModal
          resource={resource}
          open={showDetail}
          onOpenChange={setShowDetail}
          onResourceUpdated={handleResourceUpdated}
          onExtract={onExtract}
          extractionProgress={extractionProgress}
          isMyLibrary={isMyLibrary}
        />
      </TooltipProvider>
    );
  }

  // Grid view
  return (
    <TooltipProvider>
      <Card 
        onClick={handleCardClick} 
        className={`overflow-hidden group cursor-pointer hover:shadow-xl transition-all duration-300 hover:-translate-y-1 border-2 ${statusConfig.borderColor}`}
      >
        {/* Thumbnail */}
        <div className="aspect-[3/4] relative overflow-hidden bg-muted flex items-center justify-center">
        {/* Status badge - slides out on card hover */}
        <div className="absolute top-2 left-2 z-10">
          <div className="flex items-center bg-background/90 backdrop-blur-sm rounded-full shadow-lg transition-all duration-300">
            {/* Label that slides in on card hover */}
            <span className={`text-xs font-medium whitespace-nowrap transition-all duration-300 overflow-hidden max-w-0 group-hover:max-w-[120px] group-hover:pl-2 ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
            {/* Icon - always visible */}
            <div className={`flex-shrink-0 p-1.5 ${statusConfig.color}`}>
              <StatusIcon className={`h-4 w-4 ${statusConfig.spin ? 'animate-spin' : ''}`} />
            </div>
          </div>
        </div>

          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={resource.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <FileText className="h-16 w-16 text-muted-foreground/50" />
          )}

          {/* Overlay on hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
            {!isMyLibrary && (
              <Button
                variant="secondary"
                size="sm"
                className="text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToLibrary?.(resource.id, resource.name);
                }}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            )}
          </div>

          {/* Public badge */}
          {resource.is_public && (
            <Badge
              variant="secondary"
              className="absolute top-2 right-2 text-xs"
            >
              Public
            </Badge>
          )}
        </div>

        <CardContent className="p-3">
          <h3 className="font-serif font-semibold text-sm line-clamp-1 mb-1">
            {resource.name}
          </h3>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{resource.page_count} pages</span>
            <span>{formatSize(resource.size_bytes)}</span>
          </div>

          {/* Progress bar for processing - Always visible when extracting */}
          {isExtracting && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {resource.extraction_status === "pending" ? "Queued" : "Extracting"}
                </span>
                {progressValue !== undefined && <span>{progressValue}%</span>}
              </div>
              <Progress value={progressValue ?? 0} className="h-1" />
            </div>
          )}
        </CardContent>
      </Card>
      <ResourceDetailModal
        resource={resource}
        open={showDetail}
        onOpenChange={setShowDetail}
        onResourceUpdated={handleResourceUpdated}
        onExtract={onExtract}
        extractionProgress={extractionProgress}
        isMyLibrary={isMyLibrary}
      />
    </TooltipProvider>
  );
}
