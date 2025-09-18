import { useCallback, useMemo, useState } from "react";
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
  Typography,
} from "@mui/material";

interface ExifField {
  tag: string;
  ifd: string;
  value: string;
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

function App() {
  const [fields, setFields] = useState<ExifField[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasData = fields.length > 0;

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
