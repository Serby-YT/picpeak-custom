import React, { useState, useRef, useMemo } from 'react';
import { Upload, X, Image, Loader2 } from 'lucide-react';
import { Button } from '../common';
import { clsx } from 'clsx';
import { api } from '../../config/api';
import { toast } from 'react-toastify';
import { useQuery } from '@tanstack/react-query';
import { categoriesService } from '../../services/categories.service';
import { settingsService } from '../../services/settings.service';
import { photosService } from '../../services/photos.service';
import { useTranslation } from 'react-i18next';
import { extensionsToMimeTypes, extensionsToAcceptString } from '../../utils/fileTypes';

interface PhotoUploadProps {
  eventId: number;
  onUploadComplete?: () => void;
}

const DEFAULT_MAX_FILES_PER_UPLOAD = 500;
const MAX_FILES_PER_UPLOAD_LIMIT = 2000;

export const PhotoUpload: React.FC<PhotoUploadProps> = ({ eventId, onUploadComplete }) => {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Fetch categories for this event
  const { data: categories = [] } = useQuery({
    queryKey: ['event-categories', eventId],
    queryFn: () => categoriesService.getEventCategories(eventId),
  });

  const { data: settings } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => settingsService.getAllSettings(),
  });

  const maxFilesPerUpload = React.useMemo(() => {
    const rawValue = settings?.general_max_files_per_upload;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_MAX_FILES_PER_UPLOAD;
    }
    return Math.min(MAX_FILES_PER_UPLOAD_LIMIT, Math.max(1, Math.floor(parsed)));
  }, [settings]);

  const allowedMimeTypes = useMemo(
    () => extensionsToMimeTypes(settings?.general_allowed_file_types),
    [settings?.general_allowed_file_types]
  );

  const acceptString = useMemo(
    () => extensionsToAcceptString(settings?.general_allowed_file_types),
    [settings?.general_allowed_file_types]
  );

  const remainingSlots = Math.max(maxFilesPerUpload - selectedFiles.length, 0);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(file =>
      allowedMimeTypes.includes(file.type)
    );
    
    // Check total file count with existing files
    const totalFiles = selectedFiles.length + imageFiles.length;
    if (totalFiles > maxFilesPerUpload) {
      const allowedNewFiles = maxFilesPerUpload - selectedFiles.length;
      if (allowedNewFiles <= 0) {
        toast.error(
          t('upload.maxFilesReached', { limit: maxFilesPerUpload }) ||
          `Maximum ${maxFilesPerUpload} files allowed`
        );
        return;
      }
      toast.warning(
        t('upload.someFilesSkipped', { allowed: allowedNewFiles, limit: maxFilesPerUpload }) ||
        `Only ${allowedNewFiles} more files can be added (limit ${maxFilesPerUpload})`
      );
      setSelectedFiles(prev => [...prev, ...imageFiles.slice(0, allowedNewFiles)]);
      return;
    }
    
    setSelectedFiles(prev => [...prev, ...imageFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    
    // Validate file count
    if (selectedFiles.length > maxFilesPerUpload) {
      toast.error(
        t('upload.tooManyFiles', { limit: maxFilesPerUpload }) ||
        `Maximum ${maxFilesPerUpload} files can be uploaded at once`
      );
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    // For large uploads, chunk the files by both count AND size to prevent memory/network issues
    const MAX_FILES_PER_CHUNK = Math.max(1, Math.min(50, maxFilesPerUpload)); // Max 50 files per chunk
    const MAX_BYTES_PER_CHUNK = 80 * 1024 * 1024; // Max 80MB per chunk (Cloudflare proxy caps request bodies at 100MB)

    // Batching files together cannot help a file that is itself too big: it
    // would still travel as one request and the proxy would refuse it. Those go
    // up through the chunked endpoint instead, 10MB at a time.
    const oversizedFiles = selectedFiles.filter((f) => photosService.shouldUseChunkedUpload(f.size));
    const batchableFiles = selectedFiles.filter((f) => !photosService.shouldUseChunkedUpload(f.size));

    const chunks: File[][] = [];

    let currentChunk: File[] = [];
    let currentChunkSize = 0;

    for (const file of batchableFiles) {
      // Start a new chunk if adding this file would exceed limits
      if (currentChunk.length >= MAX_FILES_PER_CHUNK ||
          (currentChunkSize + file.size > MAX_BYTES_PER_CHUNK && currentChunk.length > 0)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentChunkSize = 0;
      }

      currentChunk.push(file);
      currentChunkSize += file.size;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    const totalUnits = chunks.length + oversizedFiles.length;
    setTotalChunks(totalUnits);
    let totalUploaded = 0;
    const failedFiles: string[] = [];

    // A phone hotspot never saturates a single TCP stream, and the old loop
    // also left the uplink idle while the server thumbnailed the chunk it had
    // just finished receiving. Running a few chunks at once keeps bytes moving
    // the whole time. Three is deliberate: the box has 4 cores and does its
    // image work inside the request, so more connections would only queue up
    // behind sharp without putting anything extra on the wire.
    const UPLOAD_CONCURRENCY = 3;

    // Per-unit fractional progress (0..1), summed into one overall percentage.
    // Chunks now finish out of order, so progress can no longer be derived from
    // a single 'current unit' counter.
    const unitProgress = new Array<number>(totalUnits).fill(0);
    let completedUnits = 0;

    const publishProgress = () => {
      const done = unitProgress.reduce((sum, p) => sum + p, 0);
      setUploadProgress(Math.round((done / totalUnits) * 100));
      // With several chunks in flight there is no single 'current' one; show
      // how far through the queue we are instead.
      setCurrentChunk(Math.min(completedUnits + 1, totalUnits));
    };

    // A stalled connection is the failure mode here, not a slow one: the phone
    // drops the stream, no more bytes are acknowledged, and without a deadline
    // the POST hangs forever with the bar parked just short of 100%. A flat
    // timeout would punish a legitimately slow hotspot, so watch for bytes
    // actually stopping instead.
    const CHUNK_RETRIES = 3;
    const STALL_TIMEOUT_MS = 90000;

    const uploadChunk = async (chunk: File[], unitIndex: number) => {
      for (let attempt = 1; attempt <= CHUNK_RETRIES; attempt++) {
        const formData = new FormData();

        chunk.forEach((file) => {
          formData.append("photos", file);
        });

        if (selectedCategoryId) {
          formData.append("category_id", selectedCategoryId.toString());
        }

        const controller = new AbortController();
        let lastProgressAt = Date.now();
        let allBytesSent = false;
        const watchdog = setInterval(() => {
          if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
            controller.abort();
          }
        }, 5000);

        try {
          await api.post(`/admin/events/${eventId}/upload`, formData, {
            signal: controller.signal,
            onUploadProgress: (progressEvent) => {
              lastProgressAt = Date.now();
              if (progressEvent.total) {
                const fraction = progressEvent.loaded / progressEvent.total;
                unitProgress[unitIndex] = fraction;
                publishProgress();

                // Every byte is out and the server is now writing them and
                // replying. Stop watching: aborting now would kill a request
                // the server may already have accepted, and the retry would
                // upload the same photos a second time.
                if (fraction >= 1 && !allBytesSent) {
                  allBytesSent = true;
                  clearInterval(watchdog);
                }
              }
            },
          });

          clearInterval(watchdog);
          totalUploaded += chunk.length;
          break;
        } catch (error: any) {
          clearInterval(watchdog);
          console.warn(`Chunk ${unitIndex + 1} attempt ${attempt}/${CHUNK_RETRIES} failed`, error);

          // Only a chunk that died mid-transfer is safe to send again. Once the
          // bytes were all delivered the server may have stored them, so a
          // retry risks duplicating the photos — report it and move on.
          const safeToRetry = !allBytesSent && attempt < CHUNK_RETRIES;

          if (safeToRetry) {
            // The retry re-sends the whole chunk, so give back the progress
            // this attempt had claimed.
            unitProgress[unitIndex] = 0;
            publishProgress();
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            continue;
          }

          failedFiles.push(...chunk.map((f) => f.name));
          break;
        }
      }

      unitProgress[unitIndex] = 1;
      completedUnits++;
      publishProgress();
    };

    try {
      // Worker pool rather than fixed slices: each worker pulls the next chunk
      // off the queue, so one slow chunk never holds up the ones behind it.
      let nextChunk = 0;
      const workers = Array.from(
        { length: Math.min(UPLOAD_CONCURRENCY, chunks.length) },
        async () => {
          while (nextChunk < chunks.length) {
            const index = nextChunk++;
            await uploadChunk(chunks[index], index);
          }
        }
      );
      await Promise.all(workers);

      // Oversized files, one at a time, in 10MB pieces. These already split
      // themselves across many sequential requests, so they saturate the link
      // on their own and gain nothing from running alongside each other.
      for (let i = 0; i < oversizedFiles.length; i++) {
        const file = oversizedFiles[i];
        const unitIndex = chunks.length + i;
        try {
          await photosService.uploadLargeFile(
            eventId,
            file,
            selectedCategoryId,
            (fileProgress) => {
              unitProgress[unitIndex] = fileProgress / 100;
              publishProgress();
            }
          );
          totalUploaded += 1;
        } catch (error: any) {
          console.error(`Error uploading large file ${file.name}:`, error);
          failedFiles.push(file.name);
        }
        unitProgress[unitIndex] = 1;
        completedUnits++;
        publishProgress();
      }

      // Clear selected files
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Show appropriate message
      if (failedFiles.length === 0) {
        toast.success(t('upload.uploadComplete') || `Successfully uploaded ${totalUploaded} files`);
      } else {
        toast.warning(
          `Uploaded ${totalUploaded}. Failed: ${failedFiles.join(', ')}`,
          { autoClose: false }
        );
      }
      
      // Call callback
      if (onUploadComplete) {
        onUploadComplete();
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.error || t('toast.uploadError'));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setCurrentChunk(0);
      setTotalChunks(0);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-4">
      {/* Category Selection */}
      <div>
        <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
          {t('upload.photoCategory')}
        </label>
        <select
          value={selectedCategoryId || ''}
          onChange={(e) => setSelectedCategoryId(e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-primary-500"
        >
          <option value="">{t('upload.noCategory')}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name} {!category.is_global && t('upload.eventSpecific')}
            </option>
          ))}
        </select>
      </div>

      {/* File Input Area */}
      <div
        className={clsx(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
          "hover:border-primary-400 hover:bg-primary-50/50",
          selectedFiles.length > 0 ? "border-primary-400 bg-primary-50/30 dark:bg-primary-900/20" : "border-neutral-300 dark:border-neutral-600"
        )}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-12 h-12 mx-auto text-neutral-400 dark:text-neutral-500 mb-4" />
        <p className="text-neutral-700 dark:text-neutral-300 font-medium mb-1">
          {t('upload.clickToUpload')}
        </p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t('upload.fileRequirements', { limit: maxFilesPerUpload })}
        </p>
        <p
          className={clsx(
            "text-xs mt-2",
            remainingSlots === 0 ? "text-red-600" : "text-neutral-500 dark:text-neutral-400"
          )}
        >
          {remainingSlots === 0
            ? t('upload.limitReached', { limit: maxFilesPerUpload })
            : t('upload.limitInfo', {
                selected: selectedFiles.length,
                limit: maxFilesPerUpload,
                remaining: remainingSlots,
              })}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptString}
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {t('upload.selectedFiles')} ({selectedFiles.length})
          </p>
          <div className="max-h-48 overflow-y-auto space-y-2">
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-neutral-50 dark:bg-neutral-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Image className="w-5 h-5 text-neutral-400" />
                  <div>
                    <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 truncate max-w-xs">
                      {file.name}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                  className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={handleUpload}
          disabled={selectedFiles.length === 0 || isUploading}
          leftIcon={isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        >
          {isUploading ? t('upload.uploading') : t('common.upload') + ` ${selectedFiles.length} ${t(selectedFiles.length === 1 ? 'common.photo' : 'common.photos')}`}
        </Button>
      </div>

      {/* Progress Bar */}
      {isUploading && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-neutral-600 dark:text-neutral-400 mb-1">
            <span>
              {t('upload.uploading')}
              {totalChunks > 1 && ` (${t('common.chunk')} ${currentChunk}/${totalChunks})`}
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          {totalChunks > 1 && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              {t('upload.uploadingChunks', { count: selectedFiles.length, total: totalChunks })}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

PhotoUpload.displayName = 'PhotoUpload';
