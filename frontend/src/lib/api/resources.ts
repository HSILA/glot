/**
 * Resource types and API client for the resources feature.
 */

export type ExtractionStatus = "none" | "pending" | "processing" | "completed" | "failed";

export interface Resource {
  id: number;
  content_hash: string;
  name: string;
  size_bytes: number;
  page_count: number | null;
  is_public: boolean;
  extraction_status: ExtractionStatus;
  uploaded_at: string;
  processed_at: string | null;
  is_owner: boolean;
}

export interface ResourceListResponse {
  items: Resource[];
  total: number;
  limit: number;
  offset: number;
}

export interface UploadRequest {
  name: string;
  file_name: string;
  size_bytes: number;
  content_hash: string;
  is_public: boolean;
}

export interface UploadResponse {
  upload_url: string; // Empty string if file already exists (deduplicated)
  resource_id: number;
  expires_in: number;
}

export interface ExtractionProgress {
  status: ExtractionStatus;
  progress: number;
  current_page: number | null;
  total_pages: number | null;
}

const API_BASE = "/api/v1/resources";

/**
 * Compute SHA-256 hash of a file.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// page_count is computed server-side during upload confirmation.

class ResourcesApi {
  async requestUpload(request: UploadRequest): Promise<UploadResponse> {
    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Upload request failed");
    }
    return res.json();
  }

  async confirmUpload(resourceId: number): Promise<Resource> {
    const res = await fetch(
      `${API_BASE}/upload/confirm?resource_id=${resourceId}`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Upload confirmation failed");
    }
    return res.json();
  }

  async uploadFileToR2(uploadUrl: string, file: File): Promise<void> {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error("Failed to upload file to storage");
    }
  }

  async getMyResources(
    limit = 50,
    offset = 0
  ): Promise<ResourceListResponse> {
    const res = await fetch(
      `${API_BASE}?limit=${limit}&offset=${offset}`,
      {
        credentials: "include",
      }
    );
    if (!res.ok) {
      throw new Error("Failed to fetch resources");
    }
    return res.json();
  }

  async getPublicResources(
    search?: string,
    limit = 50,
    offset = 0
  ): Promise<ResourceListResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
    });
    if (search) {
      params.set("search", search);
    }
    const res = await fetch(`${API_BASE}/public?${params}`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Failed to fetch public resources");
    }
    return res.json();
  }

  async getResource(id: number): Promise<Resource> {
    const res = await fetch(`${API_BASE}/${id}`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Failed to fetch resource");
    }
    return res.json();
  }

  async addPublicResource(id: number, name: string): Promise<Resource> {
    const res = await fetch(`${API_BASE}/${id}/add`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to add resource");
    }
    return res.json();
  }

  async updateResource(
    id: number,
    updates: { name?: string; is_public?: boolean }
  ): Promise<Resource> {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to update resource");
    }
    return res.json();
  }

  async deleteResource(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to delete resource");
    }
  }

  async triggerExtraction(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/${id}/extract`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to trigger extraction");
    }
  }

  async getExtractionProgress(id: number): Promise<ExtractionProgress> {
    const res = await fetch(`${API_BASE}/${id}/progress`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Failed to fetch extraction progress");
    }
    return res.json();
  }

  async getDownloadUrl(id: number): Promise<string> {
    const res = await fetch(`${API_BASE}/${id}/download`, {
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error("Failed to get download URL");
    }
    const data = await res.json();
    return data.url;
  }
}

export const resourcesApi = new ResourcesApi();
