import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  AppBar,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Toolbar,
  TextField,
  Typography,
} from "@mui/material";

interface ExifField {
  tag: string;
  ifd: string;
  value: string;
}

interface AestheticMatch {
  path: string;
  score: number;
}

const IMAGE_FILTERS = [
  "jpg",
  "jpeg",
  "png",
  "tif",
  "tiff",
  "webp",
  "heic",
  "heif",
  "avif",
  "bmp",
];

function formatPath(path: string | null): string {
  if (!path) {
    return "No file selected";
  }

  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(separator).filter(Boolean);
  if (parts.length === 0) {
    return path;
  }

  const fileName = parts[parts.length - 1];
  const directory = parts.slice(0, -1).join(separator);

  return directory ? `${fileName} — ${directory}` : fileName;
}

function getFileName(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(separator).filter(Boolean);
  if (parts.length === 0) {
    return path;
  }
  return parts[parts.length - 1];
}

function App() {
  const [fields, setFields] = useState<ExifField[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<AestheticMatch[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanAttempted, setScanAttempted] = useState(false);
  const [minScoreInput, setMinScoreInput] = useState("0.75");

  const hasData = fields.length > 0;
  const hasScanResults = scanResults.length > 0;
  const parsedMinScore = useMemo(() => {
    const parsed = Number.parseFloat(minScoreInput);
    return Number.isFinite(parsed) ? parsed : null;
  }, [minScoreInput]);

  const handleOpenFile = useCallback(async () => {
    setError(null);

    const selection = await open({
      multiple: false,
      filters: [
        {
          name: "Images",
          extensions: IMAGE_FILTERS,
        },
      ],
    });

    if (!selection) {
      return;
    }

    const selectedPath = Array.isArray(selection) ? selection[0] : selection;
    setFilePath(selectedPath);
    setLoading(true);

    try {
      const result = await invoke<ExifField[]>("read_exif", {
        path: selectedPath,
      });
      setFields(result);
      if (result.length === 0) {
        setError("No EXIF metadata was found in the selected file.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFields([]);
      setError(message || "Unable to read EXIF metadata for the selected file.");
    } finally {
      setLoading(false);
    }
  }, []);

  const scanFolder = useCallback(
    async (path: string) => {
      const threshold = Number.parseFloat(minScoreInput);
      if (!Number.isFinite(threshold)) {
        setScanError("Enter a valid minimum score before scanning.");
        setScanResults([]);
        setScanAttempted(true);
        return;
      }

      setScanLoading(true);
      setScanError(null);
      setScanAttempted(true);
      setScanResults([]);

      try {
        const results = await invoke<AestheticMatch[]>("find_aesthetic_images", {
          path,
          min_score: threshold,
        });
        setScanResults(results);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setScanResults([]);
        setScanError(message || "Unable to scan the selected folder.");
      } finally {
        setScanLoading(false);
      }
    },
    [minScoreInput]
  );

  const handleOpenFolder = useCallback(async () => {
    const selection = await open({
      directory: true,
      multiple: false,
    });

    if (!selection) {
      return;
    }

    const selectedPath = Array.isArray(selection) ? selection[0] : selection;
    setFolderPath(selectedPath);
    await scanFolder(selectedPath);
  }, [scanFolder]);

  const handleRescan = useCallback(() => {
    if (folderPath) {
      void scanFolder(folderPath);
    }
  }, [folderPath, scanFolder]);

  const handleMinScoreChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setMinScoreInput(event.target.value);
    },
    []
  );

  const summaryText = useMemo(() => {
    if (!filePath) {
      return "Select an image to inspect its metadata.";
    }

    if (loading) {
      return "Reading metadata…";
    }

    if (error) {
      return error;
    }

    if (!hasData) {
      return "No EXIF metadata available for this file.";
    }

    return `${fields.length} metadata entr${fields.length === 1 ? "y" : "ies"} found.`;
  }, [error, fields.length, filePath, hasData, loading]);

  const scanSummaryText = useMemo(() => {
    if (!folderPath) {
      return "Select a folder to find images with an aesthetic score above a threshold.";
    }

    if (scanLoading) {
      return "Scanning folder…";
    }

    if (scanError) {
      return "Unable to complete the folder scan.";
    }

    if (hasScanResults && parsedMinScore !== null) {
      return `${scanResults.length} image${scanResults.length === 1 ? "" : "s"} found with an aesthetic score ≥ ${parsedMinScore}.`;
    }

    if (scanAttempted && parsedMinScore !== null) {
      return `No images found with an aesthetic score of at least ${parsedMinScore}.`;
    }

    return "Choose \"Browse for folder\" to begin scanning.";
  }, [folderPath, hasScanResults, parsedMinScore, scanAttempted, scanError, scanLoading, scanResults.length]);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: (theme) => theme.palette.background.default }}>
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <PhotoLibraryIcon sx={{ mr: 2 }} />
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Exif Viewer
          </Typography>
          <Button
            color="inherit"
            onClick={handleOpenFile}
            startIcon={<RefreshIcon />}
            disabled={loading}
          >
            {filePath ? "Choose another image" : "Open image"}
          </Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 4 }}>
        <Stack spacing={3}>
          <Paper elevation={0} variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={1}>
              <Typography variant="subtitle1" color="text.secondary">
                Selected file
              </Typography>
              <Typography variant="body1" sx={{ wordBreak: "break-word" }}>
                {formatPath(filePath)}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center" mt={1}>
                <Button
                  variant="contained"
                  startIcon={<PhotoLibraryIcon />}
                  onClick={handleOpenFile}
                  disabled={loading}
                >
                  {filePath ? "Open different image" : "Browse for image"}
                </Button>
                {loading && <CircularProgress size={24} />}
              </Stack>
              {error && !loading && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
              {!error && !loading && filePath && !hasData && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  No EXIF metadata was found for this image.
                </Alert>
              )}
            </Stack>
          </Paper>

          <Paper elevation={0} variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Aesthetic score finder</Typography>
              <Typography variant="body2" color="text.secondary">
                {scanSummaryText}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center">
                <TextField
                  label="Minimum score"
                  type="number"
                  value={minScoreInput}
                  onChange={handleMinScoreChange}
                  inputProps={{ step: 0.01, min: 0 }}
                  size="small"
                  sx={{ width: { xs: "100%", sm: 180 } }}
                />
                <Stack direction="row" spacing={2} sx={{ width: { xs: "100%", sm: "auto" } }}>
                  <Button
                    variant="contained"
                    startIcon={<PhotoLibraryIcon />}
                    onClick={handleOpenFolder}
                    disabled={scanLoading}
                    fullWidth
                  >
                    {folderPath ? "Browse different folder" : "Browse for folder"}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={handleRescan}
                    disabled={scanLoading || !folderPath}
                    fullWidth
                  >
                    Rescan
                  </Button>
                </Stack>
                {scanLoading && <CircularProgress size={24} />}
              </Stack>
              {folderPath && (
                <Typography variant="body2" sx={{ wordBreak: "break-word" }} color="text.secondary">
                  {formatPath(folderPath)}
                </Typography>
              )}
              {scanError && !scanLoading && (
                <Alert severity="error">{scanError}</Alert>
              )}
              {scanAttempted && !scanLoading && !scanError && !hasScanResults && (
                <Alert severity="info">No images matched the selected threshold.</Alert>
              )}
              {hasScanResults && (
                <TableContainer>
                  <Table size="small" aria-label="Aesthetic score results table">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: "30%" }}>File name</TableCell>
                        <TableCell sx={{ width: "20%" }}>Score</TableCell>
                        <TableCell>Location</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {scanResults.map((result) => {
                        const fileName = getFileName(result.path);
                        return (
                          <TableRow key={result.path} hover>
                            <TableCell sx={{ fontWeight: 500 }}>{fileName}</TableCell>
                            <TableCell>{result.score.toFixed(3)}</TableCell>
                            <TableCell sx={{ wordBreak: "break-word" }}>{result.path}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Stack>
          </Paper>

          <Paper elevation={0} variant="outlined" sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="h6">Metadata</Typography>
              <Typography variant="body2" color="text.secondary">
                {summaryText}
              </Typography>
              {hasData && (
                <TableContainer>
                  <Table size="small" aria-label="EXIF metadata table">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: "25%" }}>Tag</TableCell>
                        <TableCell sx={{ width: "15%" }}>IFD</TableCell>
                        <TableCell>Value</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {fields.map((field) => (
                        <TableRow key={`${field.ifd}-${field.tag}`} hover>
                          <TableCell sx={{ fontWeight: 500 }}>{field.tag}</TableCell>
                          <TableCell>{field.ifd}</TableCell>
                          <TableCell sx={{ whiteSpace: "pre-wrap" }}>{field.value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Stack>
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

export default App;
