import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireFromWeb = createRequire(resolve("apps/web/package.json"));
const { createClient } = requireFromWeb("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase URL and service-role key are required.");

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const vendors = [
  {
    id: "de000000-0000-4000-8000-000000000001",
    categoryId: "de100000-0000-4000-8000-000000000001",
    email: "demo.jollof@seed.kiakia.local",
    name: "Demo Ember Kitchen",
    slug: "demo-ember-kitchen",
    category: "Jollof & Grills",
    categoryKey: "combo_meals",
    image: "jollof-grill.jpg",
    description: "Smoky Nigerian rice plates, grilled chicken and golden plantain. Temporary demo vendor.",
    items: [
      ["de200000-0000-4000-8000-000000000001", "Ember Jollof Feast", "Smoky party jollof, grilled chicken, plantain and fresh salad.", 420000],
      ["de200000-0000-4000-8000-000000000002", "Jollof & Chicken Bowl", "A generous bowl of party jollof with char-grilled chicken.", 330000],
      ["de200000-0000-4000-8000-000000000003", "Golden Plantain Combo", "Jollof rice, sweet fried plantain and peppered chicken.", 360000],
    ],
  },
  {
    id: "de000000-0000-4000-8000-000000000002",
    categoryId: "de100000-0000-4000-8000-000000000002",
    email: "demo.soup@seed.kiakia.local",
    name: "Demo Heritage Pot",
    slug: "demo-heritage-pot",
    category: "Soups & Swallow",
    categoryKey: "soups",
    image: "egusi-pounded-yam.jpg",
    description: "Comforting Nigerian soups and hand-finished swallow plates. Temporary demo vendor.",
    items: [
      ["de200000-0000-4000-8000-000000000004", "Royal Egusi & Pounded Yam", "Rich egusi soup with assorted meat and smooth pounded yam.", 480000],
      ["de200000-0000-4000-8000-000000000005", "Egusi Comfort Bowl", "Leafy egusi soup with tender beef and your choice of swallow.", 390000],
      ["de200000-0000-4000-8000-000000000006", "Pounded Yam Feast", "Two portions of pounded yam with a generous egusi serving.", 520000],
    ],
  },
  {
    id: "de000000-0000-4000-8000-000000000003",
    categoryId: "de100000-0000-4000-8000-000000000003",
    email: "demo.suya@seed.kiakia.local",
    name: "Demo Night Suya Club",
    slug: "demo-night-suya-club",
    category: "Suya & Street Grill",
    categoryKey: "proteins_grills",
    image: "suya-plantain.jpg",
    description: "Fire-grilled suya, yaji spice and late-night Abuja flavour. Temporary demo vendor.",
    items: [
      ["de200000-0000-4000-8000-000000000007", "Signature Beef Suya", "Spicy beef suya skewers with onion, tomato and cucumber.", 350000],
      ["de200000-0000-4000-8000-000000000008", "Suya & Plantain Platter", "Beef suya with caramelised plantain and fresh vegetables.", 410000],
      ["de200000-0000-4000-8000-000000000009", "Double Yaji Grill", "An extra-generous suya plate with a side of yaji spice.", 470000],
    ],
  },
];

const storagePaths = vendors.map((vendor) => `demo-catalog/${vendor.image}`);

async function cleanup() {
  const ids = vendors.map((vendor) => vendor.id);
  const { error: vendorError } = await admin.from("vendors").delete().in("id", ids);
  if (vendorError) throw vendorError;

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  for (const vendor of vendors) {
    const user = usersPage.users.find((candidate) => candidate.email === vendor.email);
    if (user) {
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) throw error;
    }
  }

  const { error: storageError } = await admin.storage.from("vendor-media").remove(storagePaths);
  if (storageError) throw storageError;
  console.log(JSON.stringify({ removedVendors: ids.length, removedImages: storagePaths.length }));
}

async function seed() {
  const { data: areas, error: areaError } = await admin
    .from("service_areas")
    .select("id, name, polygon")
    .eq("is_active", true)
    .limit(1);
  if (areaError) throw areaError;
  const area = areas?.[0];
  if (!area) throw new Error("No active service area exists; create one before seeding demo vendors.");
  const points = [];
  const collectPoints = (value) => {
    if (Array.isArray(value) && value.length >= 2 && value.every((part) => typeof part === "number")) {
      points.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(collectPoints);
  };
  if (typeof area.polygon === "string" && /^[0-9a-f]+$/i.test(area.polygon)) {
    const ewkb = Buffer.from(area.polygon, "hex");
    const littleEndian = ewkb.readUInt8(0) === 1;
    const uint32 = (offset) => littleEndian ? ewkb.readUInt32LE(offset) : ewkb.readUInt32BE(offset);
    const double = (offset) => littleEndian ? ewkb.readDoubleLE(offset) : ewkb.readDoubleBE(offset);
    const geometryType = uint32(1);
    let offset = 5;
    if ((geometryType & 0x20000000) !== 0) offset += 4;
    const ringCount = uint32(offset);
    offset += 4;
    for (let ring = 0; ring < ringCount; ring += 1) {
      const pointCount = uint32(offset);
      offset += 4;
      for (let point = 0; point < pointCount; point += 1) {
        points.push([double(offset), double(offset + 8)]);
        offset += 16;
      }
    }
  } else {
    const polygon = typeof area.polygon === "string" ? JSON.parse(area.polygon) : area.polygon;
    collectPoints(polygon?.coordinates);
  }
  if (points.length === 0) throw new Error("The active service-area polygon could not be decoded.");
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const center = {
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
  };
  const vendorState = area.name.toLowerCase().includes("ibadan") ? "Oyo" : "FCT";

  const imageUrls = new Map();
  for (const vendor of vendors) {
    const localPath = resolve("apps/web/public/assets/demo-menu", vendor.image);
    const bytes = await readFile(localPath);
    const storagePath = `demo-catalog/${vendor.image}`;
    const { error } = await admin.storage
      .from("vendor-media")
      .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    const { data } = admin.storage.from("vendor-media").getPublicUrl(storagePath);
    imageUrls.set(vendor.image, data.publicUrl);
  }

  const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;

  for (const [vendorIndex, vendor] of vendors.entries()) {
    let owner = usersPage.users.find((candidate) => candidate.email === vendor.email);
    if (!owner) {
      const { data, error } = await admin.auth.admin.createUser({
        email: vendor.email,
        password: `Demo-only-${crypto.randomUUID()}`,
        email_confirm: true,
        user_metadata: { full_name: `${vendor.name} Owner`, demo_seed: true },
      });
      if (error) throw error;
      owner = data.user;
    }

    const imageUrl = imageUrls.get(vendor.image);
    const { error: vendorError } = await admin.from("vendors").upsert({
      id: vendor.id,
      owner_user_id: owner.id,
      service_area_id: area.id,
      name: vendor.name,
      slug: vendor.slug,
      description: vendor.description,
      category: vendor.category,
      address_line: `${14 + vendorIndex * 6} Demo Food Street, Abuja`,
      landmark: "Temporary catalogue fixture",
      state: vendorState,
      location: `POINT(${center.lng + (vendorIndex - 1) * 0.0015} ${center.lat})`,
      logo_url: imageUrl,
      banner_url: imageUrl,
      status: "active",
      kyc_status: "approved",
      opening_hours: { daily: "08:00-23:00" },
      avg_prep_mins: 20 + vendorIndex * 5,
      min_order_kobo: 150000,
      delivery_radius_m: 15000,
      commission_bps: 1500,
      is_accepting_orders: true,
      rating_avg: 4.7 + vendorIndex * 0.1,
      rating_count: 120 + vendorIndex * 37,
    });
    if (vendorError) throw vendorError;

    const { error: categoryError } = await admin.from("menu_categories").upsert({
      id: vendor.categoryId,
      vendor_id: vendor.id,
      category_key: vendor.categoryKey,
      sort_order: 0,
      is_active: true,
    });
    if (categoryError) throw categoryError;

    const menuRows = vendor.items.map(([id, name, description, price_kobo], sort_order) => ({
      id,
      vendor_id: vendor.id,
      category_id: vendor.categoryId,
      name,
      description,
      image_url: imageUrl,
      price_kobo,
      prep_mins: 15 + vendorIndex * 5,
      is_available: true,
      sort_order,
      tags: ["demo", "nigerian"],
    }));
    const { error: menuError } = await admin.from("menu_items").upsert(menuRows);
    if (menuError) throw menuError;
  }

  console.log(JSON.stringify({
    serviceArea: area.name,
    vendors: vendors.map(({ name, slug, items }) => ({ name, slug, menuItems: items.length })),
    images: storagePaths.length,
  }));
}

async function verify() {
  const ids = vendors.map((vendor) => vendor.id);
  const { data: vendorRows, error: vendorError } = await admin
    .from("vendors")
    .select("id, name, slug, state, banner_url")
    .in("id", ids);
  if (vendorError) throw vendorError;
  const { data: menuRows, error: menuError } = await admin
    .from("menu_items")
    .select("id, vendor_id, image_url")
    .in("vendor_id", ids);
  if (menuError) throw menuError;

  const imageUrls = [...new Set((menuRows ?? []).map((row) => row.image_url).filter(Boolean))];
  const imageChecks = await Promise.all(
    imageUrls.map(async (imageUrl) => ({ imageUrl, status: (await fetch(imageUrl)).status })),
  );
  const { data: addressRows, error: addressError } = await admin
    .from("addresses")
    .select("state")
    .not("state", "is", null);
  if (addressError) throw addressError;
  console.log(JSON.stringify({
    vendorCount: vendorRows?.length ?? 0,
    vendorStates: [...new Set((vendorRows ?? []).map((row) => row.state))],
    menuItemCount: menuRows?.length ?? 0,
    customerStates: [...new Set((addressRows ?? []).map((row) => row.state))],
    images: imageChecks,
  }));
}

if (process.argv.includes("--cleanup")) await cleanup();
else if (process.argv.includes("--verify")) await verify();
else await seed();
