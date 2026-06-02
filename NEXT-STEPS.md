# Recovery Tools — Next Steps

## Current status

✅ Firebase CLI login fixed  
✅ Local dev runs on Node 22  
✅ Firebase emulators run  
✅ Signup works  
✅ Login works  
✅ Profile works  
✅ Products load from Firestore emulator  
✅ Product detail page works  
✅ Add to Cart works  
✅ Quantity selector works  
✅ Cart drawer works  
✅ Review crash fixed  
✅ Placeholder product image fallback updated  
✅ Shop page mostly works  

## Fixed tonight

- Updated v2 callable function pattern:
  - `getUserRoleWithPermissions`
  - `getUserOrders`
- Replaced old static product detail section in `index.html`
- Fixed product detail tab navigation by using `showTabContent`
- Added review container/form dynamically
- Changed product/cart placeholder image paths to local fallback

## Known issues

1. Checkout / Stripe checkout session still needs testing and debugging.
2. Shop filter buttons do not work yet:
   - Featured
   - Back Pain
   - Mobility
   - Show All
   - Sort dropdown
3. Local reCAPTCHA function needs `RECAPTCHA_SECRET_KEY` or a dev bypass.
4. Logout says logged out but does not redirect away from profile.
5. Need confirm `npm run build` still passes after latest cart image change.
6. Need replace temporary placeholder image with proper Recovery Tools asset.
7. `getShippingTaxSettings` returns 500 locally. Likely missing shop configuration document in Firestore emulator.

## Next session

1. Run:
   ```powershell
   npm run build
   7. Inspect `getShippingTaxSettings`:
   ```powershell
   Get-ChildItem -Path functions -Recurse -File | Select-String "getShippingTaxSettings"