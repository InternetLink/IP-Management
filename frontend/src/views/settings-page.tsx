"use client";

import type {ReactNode} from "react";
import {Button, Checkbox, Input, Label, Separator, TextArea, TextField, Spinner, toast} from "@heroui/react";
import {useState, useEffect, useCallback} from "react";
import {api} from "../lib/api";
import {useI18n} from "../i18n";

/**
 * Prisma AppSettings schema fields:
 *   organizationName, asn, contactEmail, defaultRIR,
 *   geofeedHeader, geofeedAutoASN, defaultCountryCode,
 *   geofeedPublicUrl, expiryWarningDays, utilizationThreshold
 */
export function SettingsPage() {
  const {t} = useI18n();
  const [settings, setSettings] = useState({
    organizationName: "",
    asn: "",
    contactEmail: "",
    defaultRIR: "APNIC",
    geofeedHeader: "",
    geofeedAutoASN: true,
    defaultCountryCode: "TW",
    geofeedPublicUrl: "",
    expiryWarningDays: "30",
    utilizationThreshold: "85",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({currentPassword: "", newPassword: "", confirmPassword: ""});

  useEffect(() => {
    api.settings.get().then((data: any) => {
      if (data) {
        setSettings({
          organizationName: data.organizationName ?? "NetOps Inc.",
          asn: data.asn ?? "",
          contactEmail: data.contactEmail ?? "",
          defaultRIR: data.defaultRIR ?? "APNIC",
          geofeedHeader: data.geofeedHeader ?? "",
          geofeedAutoASN: data.geofeedAutoASN ?? true,
          defaultCountryCode: data.defaultCountryCode ?? "TW",
          geofeedPublicUrl: data.geofeedPublicUrl ?? "",
          expiryWarningDays: String(data.expiryWarningDays ?? 30),
          utilizationThreshold: String(data.utilizationThreshold ?? 85),
        });
      }
    }).catch(() => {
      // Use defaults if API fails
    }).finally(() => setLoading(false));
  }, []);

  const handleSave = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.settings.update({
        organizationName: settings.organizationName,
        asn: settings.asn,
        contactEmail: settings.contactEmail,
        defaultRIR: settings.defaultRIR,
        geofeedHeader: settings.geofeedHeader,
        geofeedAutoASN: settings.geofeedAutoASN,
        defaultCountryCode: settings.defaultCountryCode,
        geofeedPublicUrl: settings.geofeedPublicUrl || null,
        expiryWarningDays: Number(settings.expiryWarningDays),
        utilizationThreshold: Number(settings.utilizationThreshold),
      });
      toast.success(t.common.save);
    } catch (err: any) {
      toast.danger(err.message);
    } finally {
      setSaving(false);
    }
  }, [settings, t]);

  const handleChangePassword = useCallback(async () => {
    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      toast.danger("Current password and new password are required");
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      toast.danger("New password must be at least 8 characters");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.danger("New password confirmation does not match");
      return;
    }

    setPasswordSaving(true);
    try {
      await api.auth.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({currentPassword: "", newPassword: "", confirmPassword: ""});
      toast.success("Password updated");
    } catch (err: any) {
      toast.danger(err.message);
    } finally {
      setPasswordSaving(false);
    }
  }, [passwordForm]);

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;

  return (
    <form className="mx-auto flex max-w-5xl flex-col gap-4 px-5 pb-10 pt-4" onSubmit={handleSave}>
      <p className="text-muted text-sm">{t.settings.subtitle}</p>
      <Separator />
      <SettingsRow label={t.settings.orgName} description={t.settings.orgNameDesc}>
        <TextField value={settings.organizationName} onChange={(v) => setSettings(s => ({...s, organizationName: v}))}>
          <Label className="sr-only">{t.settings.orgName}</Label>
          <Input fullWidth placeholder="NetOps Inc." />
        </TextField>
      </SettingsRow>
      <Separator />
      <SettingsRow label={t.settings.asn} description={t.settings.asnDesc}>
        <TextField value={settings.asn} onChange={(v) => setSettings(s => ({...s, asn: v}))}>
          <Label className="sr-only">{t.settings.asn}</Label>
          <Input fullWidth placeholder="AS13335" className="font-mono" />
        </TextField>
      </SettingsRow>
      <Separator />
      <SettingsRow label={t.settings.contactEmail} description={t.settings.contactEmailDesc}>
        <TextField value={settings.contactEmail} onChange={(v) => setSettings(s => ({...s, contactEmail: v}))}>
          <Label className="sr-only">{t.settings.contactEmail}</Label>
          <Input fullWidth placeholder="noc@example.com" type="email" />
        </TextField>
      </SettingsRow>
      <Separator />
      <SettingsRow label={t.settings.geofeedHeader} description={t.settings.geofeedHeaderDesc}>
        <TextField value={settings.geofeedHeader} onChange={(v) => setSettings(s => ({...s, geofeedHeader: v}))}>
          <Label className="sr-only">{t.settings.geofeedHeader}</Label>
          <TextArea fullWidth className="min-h-16 resize-y font-mono" />
        </TextField>
        <Checkbox
          isSelected={settings.geofeedAutoASN}
          onChange={(v) => setSettings(s => ({...s, geofeedAutoASN: v}))}
        >
          <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
          <Checkbox.Content><Label>{t.settings.includeASN}</Label></Checkbox.Content>
        </Checkbox>
      </SettingsRow>
      <Separator />
      <SettingsRow label={t.settings.expiryWarning} description={t.settings.expiryWarningDesc}>
        <TextField value={settings.expiryWarningDays} onChange={(v) => setSettings(s => ({...s, expiryWarningDays: v}))}>
          <Label className="sr-only">{t.settings.expiryWarning}</Label>
          <Input fullWidth type="number" />
        </TextField>
      </SettingsRow>
      <Separator />
      <SettingsRow label={t.settings.utilThreshold} description={t.settings.utilThresholdDesc}>
        <TextField value={settings.utilizationThreshold} onChange={(v) => setSettings(s => ({...s, utilizationThreshold: v}))}>
          <Label className="sr-only">{t.settings.utilThreshold}</Label>
          <Input fullWidth type="number" />
        </TextField>
      </SettingsRow>
      <Separator />
      <SettingsRow label="Account password" description="Change the password for the currently signed-in administrator.">
        <TextField value={passwordForm.currentPassword} onChange={(v) => setPasswordForm(s => ({...s, currentPassword: v}))}>
          <Label>Current password</Label>
          <Input fullWidth autoComplete="current-password" type="password" />
        </TextField>
        <TextField value={passwordForm.newPassword} onChange={(v) => setPasswordForm(s => ({...s, newPassword: v}))}>
          <Label>New password</Label>
          <Input fullWidth autoComplete="new-password" type="password" />
        </TextField>
        <TextField value={passwordForm.confirmPassword} onChange={(v) => setPasswordForm(s => ({...s, confirmPassword: v}))}>
          <Label>Confirm new password</Label>
          <Input fullWidth autoComplete="new-password" type="password" />
        </TextField>
        <div className="flex justify-end">
          <Button isDisabled={passwordSaving} type="button" variant="secondary" onPress={handleChangePassword}>Change password</Button>
        </div>
      </SettingsRow>
      <Separator />
      <footer className="flex items-center justify-end gap-2 pt-2">
        <Button type="reset" variant="ghost">{t.common.reset}</Button>
        <Button type="submit" isDisabled={saving}>{t.common.save}</Button>
      </footer>
    </form>
  );
}

function SettingsRow({children, description, label}: {description: string; label: string; children: ReactNode}) {
  return (
    <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-10">
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-sm font-medium">{label}</span>
        <p className="text-muted text-xs leading-snug">{description}</p>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
