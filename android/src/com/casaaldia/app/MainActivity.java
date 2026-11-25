package com.casaaldia.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CalendarContract;
import android.provider.CalendarContract.Events;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceResponse;
import android.util.Base64;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Collections;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "casa-al-dia-familiar.bernard30101994.chatgpt.site";
    private static final String APP_PATH = "/__android__/";
    private static final String APP_URL = "https://" + APP_HOST + APP_PATH;
    private static final String AUTH_HOST = "cuocktwxrkewwcmkrlbw.supabase.co";
    private static final String AUTH_CALLBACK = "com.casaaldia.app://auth";
    private static final int SAVE_FILE = 3;
    private byte[] pendingDownload;
    private static final int CHOOSE_FILE = 1;
    private static final int LOCATION = 2;
    private WebView web;
    private ValueCallback<Uri[]> files;
    private GeolocationPermissions.Callback location;
    private String locationOrigin;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new AppBridge(), "CasaAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!isApp(url)) return null;
                String path = url.getPath();
                if (path != null && path.startsWith(APP_PATH)) {
                    return bundledAsset(path.substring(APP_PATH.length()));
                }
                return missingAsset();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!request.isForMainFrame()) return true;
                if (isApp(url)) {
                    String path = url.getPath();
                    if (path != null && path.startsWith(APP_PATH)) return false;
                    if ("/".equals(path) || "/index.html".equals(path)) {
                        Uri.Builder local = Uri.parse(APP_URL).buildUpon();
                        local.encodedQuery(url.getEncodedQuery()).encodedFragment(url.getEncodedFragment());
                        view.loadUrl(local.toString());
                    }
                    return true;
                }
                if (isHttpsHost(url, AUTH_HOST) && "/auth/v1/authorize".equals(url.getPath())
                        && "google".equals(url.getQueryParameter("provider"))
                        && AUTH_CALLBACK.equals(url.getQueryParameter("redirect_to"))
                        && "s256".equalsIgnoreCase(url.getQueryParameter("code_challenge_method"))) {
                    openBrowser(url);
                } else if (request.hasGesture() && isHttpsHost(url, "www.openstreetmap.org")) {
                    openBrowser(url);
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (files != null) files.onReceiveValue(null);
                files = callback;
                try {
                    startActivityForResult(params.createIntent(), CHOOSE_FILE);
                } catch (ActivityNotFoundException error) {
                    files.onReceiveValue(null);
                    files = null;
                }
                return true;
            }

            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!isApp(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                if (location != null) location.invoke(locationOrigin, false, false);
                location = callback;
                locationOrigin = origin;
                requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION}, LOCATION);
            }
        });
        if (!openAuthCallback(getIntent())) {
            web.loadUrl(APP_URL);
        }
    }

    private WebResourceResponse bundledAsset(String path) {
        if (path.isEmpty()) path = "index.html";
        if (!path.matches("[A-Za-z0-9_./-]+") || path.contains("..") || path.startsWith("/")) {
            return missingAsset();
        }
        String extension = MimeTypeMap.getFileExtensionFromUrl(path);
        String mime;
        switch (extension) {
            case "js": case "mjs": mime = "text/javascript"; break;
            case "wasm": mime = "application/wasm"; break;
            case "woff2": mime = "font/woff2"; break;
            case "webmanifest": mime = "application/manifest+json"; break;
            default: mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        }
        try {
            return new WebResourceResponse(mime == null ? "application/octet-stream" : mime,
                "UTF-8", 200, "OK", Collections.singletonMap("Content-Security-Policy", "frame-src 'none'; object-src 'none'"),
                getAssets().open("casa/" + path));
        } catch (IOException error) {
            return missingAsset();
        }
    }

    private static WebResourceResponse missingAsset() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static boolean isApp(Uri uri) {
        return isHttpsHost(uri, APP_HOST);
    }

    private static boolean isHttpsHost(Uri uri, String host) {
        return "https".equals(uri.getScheme()) && host.equals(uri.getHost())
            && uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openAuthCallback(intent);
    }

    private boolean openAuthCallback(Intent intent) {
        Uri callback = intent.getData();
        if (!Intent.ACTION_VIEW.equals(intent.getAction()) || callback == null || !callback.isHierarchical()
                || !"com.casaaldia.app".equals(callback.getScheme()) || !"auth".equals(callback.getEncodedAuthority())
                || (callback.getPath() != null && !callback.getPath().isEmpty())) return false;
        String code = callback.getQueryParameter("code");
        String error = callback.getQueryParameter("error");
        if (code == null && error == null) return false;
        Uri.Builder local = Uri.parse(APP_URL).buildUpon();
        if (code != null) local.appendQueryParameter("code", code);
        else local.appendQueryParameter("error", error);
        setIntent(new Intent(this, MainActivity.class));
        web.loadUrl(local.toString());
        return true;
    }

    private final class AppBridge {
        @JavascriptInterface public void addCalendarEvent(String title, String details, long start,
                long end, boolean allDay, String chooserTitle, String unavailable) {
            if (title == null || title.trim().isEmpty() || start >= end) return;
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    openCalendar(title, details, start, end, allDay, chooserTitle, unavailable);
                }
            });
        }

        @JavascriptInterface public void save(String filename, String mime, String base64) {
            if (base64.length() > 30 * 1024 * 1024) return;
            byte[] bytes;
            try { bytes = Base64.decode(base64, Base64.DEFAULT); }
            catch (IllegalArgumentException error) { return; }
            runOnUiThread(new Runnable() {
                @Override public void run() { chooseDownload(filename, mime, bytes); }
            });
        }
    }

    private void openCalendar(String title, String details, long start, long end,
            boolean allDay, String chooserTitle, String unavailable) {
        Intent event = new Intent(Intent.ACTION_INSERT, Events.CONTENT_URI)
            .putExtra(Events.TITLE, title)
            .putExtra(Events.DESCRIPTION, details)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, allDay)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end);
        Map<String, Intent> targets = new LinkedHashMap<>();
        List<CharSequence> labels = new ArrayList<>();
        for (Intent candidate : new Intent[]{event, new Intent(event).setType("vnd.android.cursor.dir/event")}) {
            for (ResolveInfo match : getPackageManager().queryIntentActivities(candidate, PackageManager.MATCH_DEFAULT_ONLY)) {
                String packageName = match.activityInfo.packageName;
                if (targets.containsKey(packageName)) continue;
                labels.add(match.activityInfo.applicationInfo.loadLabel(getPackageManager()));
                targets.put(packageName, new Intent(candidate)
                    .setComponent(new ComponentName(packageName, match.activityInfo.name)));
            }
        }
        List<Intent> choices = new ArrayList<>(targets.values());
        if (choices.isEmpty()) {
            Toast.makeText(this, unavailable, Toast.LENGTH_LONG).show();
        } else if (choices.size() == 1) {
            launchCalendar(choices.get(0), unavailable);
        } else {
            new AlertDialog.Builder(this).setTitle(chooserTitle)
                .setItems(labels.toArray(new CharSequence[0]), new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface dialog, int index) {
                        launchCalendar(choices.get(index), unavailable);
                    }
                }).show();
        }
    }

    private void launchCalendar(Intent intent, String unavailable) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException error) {
            Toast.makeText(this, unavailable, Toast.LENGTH_LONG).show();
        }
    }

    private void chooseDownload(String filename, String mime, byte[] bytes) {
        if (pendingDownload != null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE).setType(mime)
            .putExtra(Intent.EXTRA_TITLE, filename);
        pendingDownload = bytes;
        try { startActivityForResult(intent, SAVE_FILE); }
        catch (ActivityNotFoundException error) {
            pendingDownload = null;
            Toast.makeText(this, "No se pudo abrir el selector de archivos", Toast.LENGTH_LONG).show();
        }
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void openBrowser(Uri url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No se encontró un navegador para abrir este enlace", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == SAVE_FILE) {
            byte[] bytes = pendingDownload;
            pendingDownload = null;
            if (bytes != null && result == RESULT_OK && data != null && data.getData() != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output == null) throw new IOException("Output unavailable");
                    output.write(bytes);
                } catch (IOException | SecurityException error) {
                    Toast.makeText(this, "No se pudo guardar el archivo", Toast.LENGTH_LONG).show();
                }
            }
        }
        if (request == CHOOSE_FILE && files != null) {
            files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            files = null;
        }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == LOCATION && location != null) {
            location.invoke(locationOrigin, hasLocation(), false);
            location = null;
        }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
