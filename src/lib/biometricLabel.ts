// Platform-honest label for the local-key biometric unlock. iOS = Face ID; every other platform's WebAuthn PRF
// authenticator is a "passkey" (Touch ID / Windows Hello / a QR-to-phone passkey). Same UA check the auth gate
// uses for isMobile/isIOS.
export function biometricLabel(): string {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Face ID' : 'passkey';
}
