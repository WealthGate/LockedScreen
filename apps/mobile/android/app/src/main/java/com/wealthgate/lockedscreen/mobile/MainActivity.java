package com.wealthgate.lockedscreen.mobile;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        enterImmersiveMode();
        allowLockTaskWhenDeviceOwner();
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        startLockTaskIfPossible();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private DevicePolicyManager getDevicePolicyManager() {
        return (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    private ComponentName getDeviceAdminComponent() {
        return new ComponentName(this, LockedscreenDeviceAdminReceiver.class);
    }

    private void allowLockTaskWhenDeviceOwner() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }

        DevicePolicyManager manager = getDevicePolicyManager();
        if (manager != null && manager.isDeviceOwnerApp(getPackageName())) {
            manager.setLockTaskPackages(getDeviceAdminComponent(), new String[] { getPackageName() });
        }
    }

    private void startLockTaskIfPossible() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            return;
        }

        try {
            startLockTask();
        } catch (IllegalArgumentException ignored) {
            // Unmanaged devices cannot enter full lock task mode. The web runtime still uses fullscreen focus mode.
        } catch (SecurityException ignored) {
            // MDM/device-owner provisioning is required for school-grade kiosk enforcement.
        }
    }
}
