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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  // Poll for extraction progress
  useEffect(() => {
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
    }, 2000);

    return () => clearInterval(interval);
  }, [myResources, fetchMyResources]);

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

  const renderEmptyState = () => {
    if (activeTab === "my") {
      return (
        <div className="text-center py-20">
          <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            {searchQuery
              ? "No resources match your search"
              : "No resources yet. Upload your first PDF!"}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={() => setIsUploadOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Resource
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="text-center py-20">
        <Globe className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">
          {debouncedSearch
            ? "No public resources match your search"
            : "No public resources available yet"}
        </p>
      </div>
    );
  };

  const renderResourceGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
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
          onAddToLibrary={activeTab === "public" ? handleAddToLibrary : undefined}
          extractionProgress={
            activeTab === "my" ? extractionProgress[resource.id] : undefined
          }
        />
      ))}
    </div>
  );

  const renderResourceList = () => (
    <div className="space-y-3">
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
          onAddToLibrary={activeTab === "public" ? handleAddToLibrary : undefined}
          extractionProgress={
            activeTab === "my" ? extractionProgress[resource.id] : undefined
          }
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground">
            {activeTab === "my"
              ? `${myResources.length} ${myResources.length === 1 ? "resource" : "resources"} in your collection`
              : "Discover resources shared by the community"}
          </p>
        </div>
        {activeTab === "my" && (
          <Button
            className="gap-2 w-full md:w-auto"
            onClick={() => setIsUploadOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Resource
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "my" | "public")}
      >
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="my" className="gap-2">
            <BookOpen className="h-4 w-4" />
            My Library
          </TabsTrigger>
          <TabsTrigger value="public" className="gap-2">
            <Globe className="h-4 w-4" />
            Public Library
          </TabsTrigger>
        </TabsList>

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder={
                activeTab === "my"
                  ? "Search resources..."
                  : "Search public resources..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Filter & View Toggle */}
          <div className="flex gap-2">
            {activeTab === "my" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>All Resources</DropdownMenuItem>
                  <DropdownMenuItem>Extracted</DropdownMenuItem>
                  <DropdownMenuItem>Pending</DropdownMenuItem>
                  <DropdownMenuItem>Public</DropdownMenuItem>
                  <DropdownMenuItem>Private</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <div className="flex rounded-lg border border-input overflow-hidden">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10 rounded-none"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10 rounded-none"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Content */}
        <TabsContent value="my" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={fetchMyResources}
              >
                Try Again
              </Button>
            </div>
          ) : filteredMyResources.length === 0 ? (
            renderEmptyState()
          ) : viewMode === "grid" ? (
            renderResourceGrid()
          ) : (
            renderResourceList()
          )}
        </TabsContent>

        <TabsContent value="public" className="mt-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={fetchPublicResources}
              >
                Try Again
              </Button>
            </div>
          ) : publicResources.length === 0 ? (
            renderEmptyState()
          ) : viewMode === "grid" ? (
            renderResourceGrid()
          ) : (
            renderResourceList()
          )}
        </TabsContent>
      </Tabs>

      {/* Upload Modal */}
      <UploadModal
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUploadComplete={fetchMyResources}
      />
    </div>
  );
}
