"use client";

import { useState, useCallback } from "react";
import { Upload, FileText, X, Check, Loader2, Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  resourcesApi,
  computeFileHash,
  getPdfPageCount,
} from "@/lib/api/resources";

const MAX_FILE_SIZE = 75 * 1024 * 1024; // 75 MB

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete?: () => void;
}

type UploadState = "idle" | "uploading" | "processing" | "success" | "error";

export function UploadModal({
  open,
  onOpenChange,
  onUploadComplete,
}: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const resetState = useCallback(() => {
    setFile(null);
    setName("");
    setIsPublic(false);
    setUploadState("idle");
    setUploadProgress(0);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (uploadState === "uploading" || uploadState === "processing") {
      return; // Don't allow closing during upload
    }
    resetState();
    onOpenChange(false);
  }, [uploadState, resetState, onOpenChange]);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setError(null);

    // Validate file type
    if (selectedFile.type !== "application/pdf") {
      setError("Only PDF files are supported");
      return;
    }

    // Validate file size
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB`);
      return;
    }

    setFile(selectedFile);
    // Pre-fill name from filename (without extension)
    const fileName = selectedFile.name.replace(/\.pdf$/i, "");
    setName(fileName);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) {
        handleFileSelect(selectedFile);
      }
    },
    [handleFileSelect]
  );

  const handleUpload = async () => {
    if (!file || !name.trim()) return;

    try {
      setUploadState("processing");
      setUploadProgress(10);

      // Step 1: Compute hash and page count FIRST
      const [contentHash, pageCount] = await Promise.all([
        computeFileHash(file),
        getPdfPageCount(file),
      ]);
      setUploadProgress(30);

      // Step 2: Request upload URL (includes deduplication check)
      setUploadState("uploading");
      const uploadResponse = await resourcesApi.requestUpload({
        name: name.trim(),
        file_name: file.name,  // Original filename
        size_bytes: file.size,
        content_hash: contentHash,
        page_count: pageCount,
        is_public: isPublic,
      });
      setUploadProgress(40);

      // Step 3: Upload to R2 (if needed - empty URL means deduplicated)
      if (uploadResponse.upload_url) {
        await resourcesApi.uploadFileToR2(uploadResponse.upload_url, file);
        setUploadProgress(80);

        // Step 4: Confirm upload (generates thumbnail)
        await resourcesApi.confirmUpload(uploadResponse.resource_id);
      }
      setUploadProgress(100);

      // Success!
      setUploadState("success");

      // Close after a brief delay to show success state
      setTimeout(() => {
        resetState();
        onOpenChange(false);
        onUploadComplete?.();
      }, 1500);
    } catch (err) {
      setUploadState("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isUploading = uploadState === "uploading" || uploadState === "processing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a Resource</DialogTitle>
          <DialogDescription>
            Upload a PDF document to your library
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Drop Zone */}
          {!file && uploadState === "idle" && (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">
                Drop your PDF here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Maximum file size: {MAX_FILE_SIZE / (1024 * 1024)} MB
              </p>
            </div>
          )}

          {/* File Selected */}
          {file && (
            <div className="space-y-4">
              {/* File Info */}
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <FileText className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                {uploadState === "idle" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setFile(null);
                      setName("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {uploadState === "success" && (
                  <div className="p-1 bg-green-500 rounded-full">
                    <Check className="h-4 w-4 text-white" />
                  </div>
                )}
              </div>

              {/* Name Input */}
              {uploadState === "idle" && (
                <>
                  <div className="space-y-2">
                    <label htmlFor="resource-name" className="text-sm font-medium">
                      Name
                    </label>
                    <div className="flex">
                      <input
                        id="resource-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter resource name"
                        className="flex-1 h-10 px-3 rounded-l-lg border border-r-0 border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <span className="inline-flex items-center px-3 h-10 rounded-r-lg border border-input bg-muted text-sm text-muted-foreground">
                        .pdf
                      </span>
                    </div>
                  </div>

                  {/* Visibility Toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isPublic ? (
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">
                        {isPublic ? "Public" : "Private"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsPublic(!isPublic)}
                    >
                      {isPublic ? "Make Private" : "Make Public"}
                    </Button>
                  </div>
                </>
              )}

              {/* Upload Progress */}
              {isUploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {uploadState === "uploading" ? "Uploading..." : "Processing..."}
                    </span>
                    <span className="text-muted-foreground">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-2" />
                </div>
              )}

              {/* Success Message */}
              {uploadState === "success" && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  <span>Upload complete!</span>
                </div>
              )}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || !name.trim() || isUploading || uploadState === "success"}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Uploading
              </>
            ) : (
              "Upload"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
