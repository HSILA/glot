"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ZoomIn, ZoomOut, Maximize2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

interface PDFViewerProps {
  url: string;
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Lazy-loaded page component
function LazyPage({ 
  pageNumber, 
  width,
  onRef 
}: { 
  pageNumber: number; 
  width: number;
  onRef: (el: HTMLDivElement | null) => void;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Load when within 500px of viewport
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px" }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={(el) => {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        onRef(el);
      }}
    >
      {isVisible ? (
        <Page
          pageNumber={pageNumber}
          width={width}
          className="shadow-lg bg-white"
          renderTextLayer={false}
          renderAnnotationLayer={false}
          loading={
            <div 
              className="flex items-center justify-center bg-white rounded shadow-lg"
              style={{ height: width * 1.29, width }}
            >
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          }
          error={
            <div 
              className="flex items-center justify-center bg-white rounded shadow-lg"
              style={{ height: 400, width }}
            >
              <p className="text-destructive text-sm">Failed to render page {pageNumber}</p>
            </div>
          }
        />
      ) : (
        <div 
          className="bg-muted/30 rounded shadow-lg flex items-center justify-center"
          style={{ height: width * 1.29, width }}
        >
          <span className="text-muted-foreground text-sm">Page {pageNumber}</span>
        </div>
      )}
    </div>
  );
}

export function PDFViewer({ url, title, open, onOpenChange }: PDFViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState("1");
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Base width - smaller for faster loading
  const baseWidth = 550;

  const onDocumentLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setNumPages(numPages);
      setIsLoading(false);
      setError(null);
      pageRefs.current = new Array(numPages).fill(null);
    },
    []
  );

  const onDocumentLoadError = useCallback((err: Error) => {
    setIsLoading(false);
    setError(err.message);
    console.error("PDF load error:", err);
  }, []);

  const zoomIn = () => setScale((s) => Math.min(3.0, +(s + 0.25).toFixed(2)));
  const zoomOut = () => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)));
  const resetZoom = () => setScale(1.0);

  const goToPage = (page: number) => {
    const clampedPage = Math.max(1, Math.min(numPages, page));
    const ref = pageRefs.current[clampedPage - 1];
    if (ref) {
      ref.scrollIntoView({ behavior: "instant", block: "start" });
    }
    setPageInput(String(clampedPage));
  };

  const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const page = parseInt(pageInput, 10);
      if (!isNaN(page) && page >= 1 && page <= numPages) {
        goToPage(page);
      } else {
        setPageInput("1");
      }
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);

    // Reset state when dialog opens (avoid setState inside an effect)
    if (nextOpen) {
      setIsLoading(true);
      setError(null);
      setScale(1.0);
      setPageInput("1");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <DialogTitle className="text-lg font-semibold truncate pr-8">
            {title || "PDF Viewer"}
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 flex-shrink-0">
          {/* Go to Page */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Go to:</span>
            <Input
              type="text"
              value={pageInput}
              onChange={(e) => {
                if (/^\d*$/.test(e.target.value)) {
                  setPageInput(e.target.value);
                }
              }}
              onKeyDown={handlePageInputKeyDown}
              className="h-8 w-16 text-center text-sm"
              placeholder="1"
            />
            <span className="text-sm text-muted-foreground">
              of {numPages || "..."}
            </span>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={zoomOut}
              disabled={scale <= 0.5}
              className="h-8 w-8"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm min-w-[50px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={zoomIn}
              disabled={scale >= 3.0}
              className="h-8 w-8"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={resetZoom}
              className="h-8 w-8"
              title="Reset zoom"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PDF Content */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto bg-muted/50 p-4"
        >
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-destructive">Failed to load PDF</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {/* CSS transform for instant zoom */}
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top center",
              transition: "transform 0.1s ease-out",
            }}
          >
            <Document
              file={url}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={null}
              className="flex flex-col items-center gap-4"
            >
              {Array.from({ length: numPages }, (_, index) => (
                <LazyPage
                  key={`page_${index + 1}`}
                  pageNumber={index + 1}
                  width={baseWidth}
                  onRef={(el) => {
                    pageRefs.current[index] = el;
                  }}
                />
              ))}
            </Document>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
