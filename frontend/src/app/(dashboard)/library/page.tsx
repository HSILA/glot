"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Grid3X3,
  List,
  Plus,
  Filter,
  Loader2,
  BookOpen,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResourceCard } from "@/components/resources/resource-card";
import { UploadModal } from "@/components/resources/upload-modal";
import {
  resourcesApi,
  type Resource,
  type ExtractionStatus,
} from "@/lib/api/resources";

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<"my" | "public">("my");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [myResources, setMyResources] = useState<Resource[]>([]);
  const [publicResources, setPublicResources] = useState<Resource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [extractionProgress, setExtractionProgress] = useState<
    Record<number, number>
  >({});

  // Debounce search for public library
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchMyResources = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await resourcesApi.getMyResources();
      setMyResources(response.items);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load resources"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchPublicResources = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await resourcesApi.getPublicResources(
        debouncedSearch || undefined
      );
      setPublicResources(response.items);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load resources"
      );
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    if (activeTab === "my") {
      fetchMyResources();
    } else {
      fetchPublicResources();
    }
  }, [activeTab, fetchMyResources, fetchPublicResources]);

  useEffect(() => {
    const updateVisibility = () => {
      setIsTabVisible(document.visibilityState === "visible");
    };

    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);

    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  // Poll for extraction progress
  useEffect(() => {
    if (activeTab !== "my" || !isTabVisible) return;

    const processingResources = myResources.filter(
      (r) =>
        r.extraction_status === "pending" || r.extraction_status === "processing"
    );

    if (processingResources.length === 0) return;

    const interval = setInterval(async () => {
      for (const resource of processingResources) {
        try {
          const progress = await resourcesApi.getExtractionProgress(
            resource.id
          );
          setExtractionProgress((prev) => ({
            ...prev,
            [resource.id]: progress.progress,
          }));

          // Refresh if status changed
          if (progress.status !== resource.extraction_status) {
            fetchMyResources();
          }
        } catch {
          // Ignore errors
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeTab, isTabVisible, myResources, fetchMyResources]);

  const handleExtract = async (id: number) => {
    try {
      await resourcesApi.triggerExtraction(id);
      setMyResources((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, extraction_status: "pending" as ExtractionStatus }
            : r
        )
      );
    } catch (err) {
      console.error("Extraction failed:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Remove this resource from your library?")) return;

    try {
      await resourcesApi.deleteResource(id);
      setMyResources((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  const handleToggleVisibility = async (id: number, isPublic: boolean) => {
    try {
      const updated = await resourcesApi.updateResource(id, {
        is_public: isPublic,
      });
      setMyResources((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const handleResourceUpdated = (updated: Resource) => {
    setMyResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  };

  const handleAddToLibrary = async (id: number, name: string) => {
    try {
      await resourcesApi.addPublicResource(id, name);
      alert("Resource added to your library!");
    } catch (err) {
      console.error("Failed to add resource:", err);
      alert(err instanceof Error ? err.message : "Failed to add resource");
    }
  };

  const filteredMyResources = myResources.filter((r) =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentResources = activeTab === "my" ? filteredMyResources : publicResources;

  // --- Tab pill component ---
  const TabPill = ({
    value,
    label,
    icon: Icon,
  }: {
    value: string;
    label: string;
    icon: typeof BookOpen;
  }) => {
    const isActive = activeTab === value;
    return (
      <button
        onClick={() => setActiveTab(value as "my" | "public")}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: isActive ? "var(--surface-2)" : "transparent",
          color: isActive ? "var(--fg)" : "var(--muted)",
        }}
      >
        <Icon size={15} />
        {label}
      </button>
    );
  };

  // --- Empty state ---
  const EmptyState = () => {
    if (activeTab === "my") {
      return (
        <div
          className="text-center py-20"
          style={{ color: "var(--muted)" }}
        >
          <BookOpen
            className="mx-auto mb-4 opacity-30"
            size={48}
            style={{ color: "var(--muted-2)" }}
          />
          <p className="text-base">
            {searchQuery
              ? "No resources match your search"
              : "No resources yet. Upload your first PDF!"}
          </p>
          {!searchQuery && (
            <Button
              variant="primary"
              className="mt-4 gap-2"
              onClick={() => setIsUploadOpen(true)}
            >
              <Plus size={14} />
              Add Resource
            </Button>
          )}
        </div>
      );
    }
    return (
      <div
        className="text-center py-20"
        style={{ color: "var(--muted)" }}
      >
        <Globe
          className="mx-auto mb-4 opacity-30"
          size={48}
          style={{ color: "var(--muted-2)" }}
        />
        <p className="text-base">
          {debouncedSearch
            ? "No public resources match your search"
            : "No public resources available yet"}
        </p>
      </div>
    );
  };

  return (
    <div style={{ padding: "32px clamp(20px, 5vw, 56px)", maxWidth: 1080, margin: "0 auto" }}>
      {/* === Header === */}
      <div className="flex items-end justify-between mb-7">
        <h1
          className="tracking-tight"
          style={{
            fontFamily: "var(--serif)",
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: "-0.03em",
          }}
        >
          Library
        </h1>
        {activeTab === "my" && (
          <Button
            variant="primary"
            className="gap-2 hidden sm:inline-flex"
            onClick={() => setIsUploadOpen(true)}
          >
            <Plus size={14} />
            Add source
          </Button>
        )}
      </div>

      {/* === Tabs + Search bar === */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Tab pills */}
        <div
          className="flex gap-1 p-1 rounded-xl border max-w-fit"
          style={{
            background: "var(--surface)",
            borderColor: "var(--line)",
          }}
        >
          <TabPill value="my" label="My Library" icon={BookOpen} />
          <TabPill value="public" label="Public Library" icon={Globe} />
        </div>

        {/* Search + filters */}
        <div className="flex gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              size={15}
              style={{ color: "var(--muted)" }}
            />
            <input
              type="text"
              placeholder={
                activeTab === "my"
                  ? "Search resources..."
                  : "Search public resources..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-lg text-sm outline-none transition-colors"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                color: "var(--fg)",
              }}
            />
          </div>

          {/* View toggle */}
          <div
            className="flex rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--line)" }}
          >
            <button
              onClick={() => setViewMode("grid")}
              className="flex items-center justify-center w-10 h-10 transition-colors"
              style={{
                background: viewMode === "grid" ? "var(--surface-2)" : "transparent",
                color: viewMode === "grid" ? "var(--fg)" : "var(--muted)",
              }}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className="flex items-center justify-center w-10 h-10 transition-colors"
              style={{
                background: viewMode === "list" ? "var(--surface-2)" : "transparent",
                color: viewMode === "list" ? "var(--fg)" : "var(--muted)",
              }}
            >
              <List size={16} />
            </button>
          </div>

          {/* Mobile add button */}
          {activeTab === "my" && (
            <Button
              variant="primary"
              className="sm:hidden"
              size="icon"
              onClick={() => setIsUploadOpen(true)}
            >
              <Plus size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* === Content === */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2
            className="animate-spin"
            size={32}
            style={{ color: "var(--muted-2)" }}
          />
        </div>
      ) : error ? (
        <div className="text-center py-20" style={{ color: "var(--muted)" }}>
          <p>{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={activeTab === "my" ? fetchMyResources : fetchPublicResources}
          >
            Try Again
          </Button>
        </div>
      ) : currentResources.length === 0 ? (
        <EmptyState />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {currentResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              viewMode="grid"
              isMyLibrary={activeTab === "my"}
              onExtract={activeTab === "my" ? handleExtract : undefined}
              onDelete={activeTab === "my" ? handleDelete : undefined}
              onToggleVisibility={
                activeTab === "my" ? handleToggleVisibility : undefined
              }
              onResourceUpdated={
                activeTab === "my" ? handleResourceUpdated : undefined
              }
              onAddToLibrary={
                activeTab === "public" ? handleAddToLibrary : undefined
              }
              extractionProgress={
                activeTab === "my"
                  ? extractionProgress[resource.id]
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {currentResources.map((resource) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              viewMode="list"
              isMyLibrary={activeTab === "my"}
              onExtract={activeTab === "my" ? handleExtract : undefined}
              onDelete={activeTab === "my" ? handleDelete : undefined}
              onToggleVisibility={
                activeTab === "my" ? handleToggleVisibility : undefined
              }
              onResourceUpdated={
                activeTab === "my" ? handleResourceUpdated : undefined
              }
              onAddToLibrary={
                activeTab === "public" ? handleAddToLibrary : undefined
              }
              extractionProgress={
                activeTab === "my"
                  ? extractionProgress[resource.id]
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* === Upload Modal === */}
      <UploadModal
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUploadComplete={fetchMyResources}
      />
    </div>
  );
}
