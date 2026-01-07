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
  page_count: number;
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

/**
 * Get page count from PDF file.
 * This is a simple approach - for more accuracy, use pdf-lib or pdfjs-dist.
 */
export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("latin1").decode(bytes);

  // Count /Type /Page occurrences (simple heuristic)
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 1;
}

class ResourcesApi {
  private getAuthHeader(): HeadersInit {
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async requestUpload(request: UploadRequest): Promise<UploadResponse> {
    const res = await fetch(`${API_BASE}/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeader(),
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
        headers: this.getAuthHeader(),
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
        headers: this.getAuthHeader(),
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
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      throw new Error("Failed to fetch public resources");
    }
    return res.json();
  }

  async getResource(id: number): Promise<Resource> {
    const res = await fetch(`${API_BASE}/${id}`, {
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      throw new Error("Failed to fetch resource");
    }
    return res.json();
  }

  async addPublicResource(id: number, name: string): Promise<Resource> {
    const res = await fetch(`${API_BASE}/${id}/add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeader(),
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
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeader(),
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
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to delete resource");
    }
  }

  async triggerExtraction(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/${id}/extract`, {
      method: "POST",
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.detail || "Failed to trigger extraction");
    }
  }

  async getExtractionProgress(id: number): Promise<ExtractionProgress> {
    const res = await fetch(`${API_BASE}/${id}/progress`, {
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      throw new Error("Failed to fetch extraction progress");
    }
    return res.json();
  }

  async getDownloadUrl(id: number): Promise<string> {
    const res = await fetch(`${API_BASE}/${id}/download`, {
      headers: this.getAuthHeader(),
    });
    if (!res.ok) {
      throw new Error("Failed to get download URL");
    }
    const data = await res.json();
    return data.url;
  }
}

export const resourcesApi = new ResourcesApi();
