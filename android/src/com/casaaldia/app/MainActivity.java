package com.casaaldia.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String APP_HOST = "casa-al-dia-familiar.bernard30101994.chatgpt.site";
    private static final String APP_URL = "https://" + APP_HOST + "/";
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
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (isApp(url)) return false;
                if (request.isForMainFrame() && "https".equals(url.getScheme())) {
                    boolean oauth = "accounts.google.com".equals(url.getHost())
                        || ("cuocktwxrkewwcmkrlbw.supabase.co".equals(url.getHost())
                            && "/auth/v1/authorize".equals(url.getPath()));
                    openBrowser(oauth ? Uri.parse(APP_URL) : url);
                    if (oauth) Toast.makeText(MainActivity.this,
                        "Continúa con Google en el navegador", Toast.LENGTH_LONG).show();
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
        web.setDownloadListener(new DownloadListener() {
            @Override public void onDownloadStart(String address, String agent, String disposition, String mime, long size) {
                Uri uri = Uri.parse(address);
                if ("https".equals(uri.getScheme())) openBrowser(uri);
            }
        });
        if (state == null || web.restoreState(state) == null) web.loadUrl(APP_URL);
    }

    private static boolean isApp(Uri uri) {
        return "https".equals(uri.getScheme()) && APP_HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void openBrowser(Uri url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "Abre Casa al Día en un navegador", Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
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

    @Override protected void onSaveInstanceState(Bundle state) {
        web.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
