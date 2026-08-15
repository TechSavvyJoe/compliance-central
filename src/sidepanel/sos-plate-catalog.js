/**
 * Official Michigan plate artwork used by the public registration-fee
 * calculator. The IDs and SOS option values are local workflow identifiers;
 * every image and source link is an official Michigan.gov asset.
 */

const IMAGE_ROOT =
  "https://www.michigan.gov/sos/-/media/Project/Websites/sos/Vehicle/License-plate-images";
const CALCULATOR_IMAGE_ROOT = "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG";
const STANDARD_WHITE_GALLERY =
  "Standard_PureMichigan.jpg?mw=768&rev=7d34d742a2654b28a629235f959fa5e8&hash=0B2EA17F2FF650FC8464D07C074FA926";
const MACKINAC_GALLERY =
  "Standard_MacBridge.jpg?mw=768&rev=a9a336275c954f098a45fa080180d621&hash=B11CBC4C18A16DE56BB94F218BA8164C";
const AMATEUR_RADIO_GALLERY =
  "SpecialOrg_AmateurRadio.jpg?mw=768&rev=cdc8a12df3a645269e9679353cbf6581&hash=346FFA9230108990C06C977718ABD9BB";

// The public calculator publishes larger exact artwork for some designs than
// the Michigan.gov gallery does. These URLs were verified against the live
// calculator and are intentionally explicit because several image keys do not
// match the option value and must never be guessed.
const VERIFIED_LARGE_IMAGES = Object.freeze({
  water_winter_wonderland: `${CALCULATOR_IMAGE_ROOT}/MM.PAS.WW.jpg`,
  water_wonderland: `${CALCULATOR_IMAGE_ROOT}/MM.PAS.WA.jpg`,
  sc_childrens_trust: `${CALCULATOR_IMAGE_ROOT}/MM.SC.CTF.PM`,
  sc_detroit_lions: `${CALCULATOR_IMAGE_ROOT}/MM.SC.LION.PM`,
  sc_detroit_pistons: `${CALCULATOR_IMAGE_ROOT}/MM.SC.PIS.PM`,
  sc_detroit_red_wings: `${CALCULATOR_IMAGE_ROOT}/MM.SC.RW.PM`,
  sc_detroit_tigers: `${CALCULATOR_IMAGE_ROOT}/MM.SC.TGR.PM`,
  sc_4h: `${CALCULATOR_IMAGE_ROOT}/MM.SC.4H.PM.png`,
  u_eastern_michigan: `${CALCULATOR_IMAGE_ROOT}/MM.U.EMU.PM`,
  u_grand_valley: `${CALCULATOR_IMAGE_ROOT}/MM.U.GVSU.PM.png`,
  u_saginaw_valley: `${CALCULATOR_IMAGE_ROOT}/MM.U.SVSU.PM`,
  u_wayne_state: `${CALCULATOR_IMAGE_ROOT}/MM.U.WSU.PM`,
  vt_blue_star: `${CALCULATOR_IMAGE_ROOT}/MM.VT.BLU.PM`,
  vt_disabled_standard: `${CALCULATOR_IMAGE_ROOT}/MM.VT.SDV.PM.png`,
});

export const SOS_PLATE_SOURCE_PAGES = Object.freeze({
  standard: "https://www.michigan.gov/sos/vehicle/license-plates/standard-plate-options",
  legacy: "https://www.michigan.gov/sos/vehicle/license-plates/legacy-plate-options",
  specialCause:
    "https://www.michigan.gov/sos/vehicle/license-plates/special-cause-fundraising-options",
  university: "https://www.michigan.gov/sos/vehicle/license-plates/university-plate-options",
  military:
    "https://www.michigan.gov/sos/vehicle/license-plates/military-and-veteran-plate-options",
  organization:
    "https://www.michigan.gov/sos/vehicle/license-plates/amateur-radio-and-special-organization-plate-options",
  industry: "https://www.michigan.gov/sos/vehicle/license-plates",
});

const STANDARD_WHITE = Object.freeze({
  field: "Plate Background",
  optionLabel: "Standard White",
  optionValue: "PM",
});

const RESTRICTED_NOTES = Object.freeze({
  VT: "Military or veteran eligibility documentation is required.",
  GLD: "Gold Star Family eligibility documentation is required.",
  ARO: "An eligible FCC amateur-radio call sign is required.",
  PSO: "Current membership and organization documentation are required.",
  CONSUL: "Honorary consul eligibility documentation is required.",
});

function officialImage(path) {
  if (!path) return null;
  return /^https:\/\//.test(path) ? path : `${IMAGE_ROOT}/${path}`;
}

function highResolutionImage(path) {
  const imageUrl = officialImage(path);
  if (!imageUrl) return null;

  const url = new URL(imageUrl);
  if (url.hostname === "www.michigan.gov") {
    // Michigan's published gallery supports a larger rendition through the
    // same official Sitecore media URL. Keep the exact revision/hash while
    // requesting enough source pixels for the interactive viewer.
    url.searchParams.set("mw", "1600");
  }
  return url.href;
}

function makeDesign({
  value,
  plateType,
  label,
  image,
  source,
  selection,
  background = null,
}) {
  return Object.freeze({
    value,
    plateType,
    label,
    imageUrl: officialImage(image),
    fullImageUrl: VERIFIED_LARGE_IMAGES[value] || highResolutionImage(image),
    sourceUrl: SOS_PLATE_SOURCE_PAGES[source],
    selection: Object.freeze({ ...selection }),
    background: background ? Object.freeze({ ...background }) : null,
    restricted: Boolean(RESTRICTED_NOTES[plateType]),
    eligibilityNote: RESTRICTED_NOTES[plateType] || "",
  });
}

function backgroundDesign(value, plateType, label, image, source, optionLabel, optionValue) {
  return makeDesign({
    value,
    plateType,
    label,
    image,
    source,
    selection: { field: "Plate Background", optionLabel, optionValue },
  });
}

function subtypeDesign(value, plateType, label, image, source, optionValue, optionLabel = label) {
  return makeDesign({
    value,
    plateType,
    label,
    image,
    source,
    selection: { field: "Plate Sub Type", optionLabel, optionValue },
    background: STANDARD_WHITE,
  });
}

const DESIGNS = [
  backgroundDesign(
    "pure_michigan",
    "PAS",
    "Pure Michigan",
    STANDARD_WHITE_GALLERY,
    "standard",
    "Standard White",
    "PMB"
  ),
  backgroundDesign(
    "mackinac_bridge",
    "PAS",
    "Mackinac Bridge",
    MACKINAC_GALLERY,
    "standard",
    "Mackinac Bridge",
    "BR"
  ),
  backgroundDesign(
    "water_winter_wonderland",
    "PAS",
    "Water-Winter Wonderland",
    "Standard_WaterWinterWonderland.png?mw=768&rev=4ec3441ac8154aee98632aadf2f31559&hash=9E5344E36B1789CBF14E14A664EDE4F5",
    "standard",
    "Water-Winter Wonderland",
    "WW"
  ),
  backgroundDesign(
    "water_wonderland",
    "PAS",
    "Water Wonderland",
    "Standard_WaterWonderland.png?mw=768&rev=5d1d477b24fe41079f081b68961d4015&hash=185FEA739A4F41E0A5DB594CF4013A86",
    "standard",
    "Water Wonderland",
    "GW"
  ),

  backgroundDesign(
    "legacy_great_lake_state",
    "LCY",
    "Great Lake State — Black",
    "Legacy_GreatLakeState.png?mw=768&rev=9a1f62e1c63b44289a74c52f33aa2a85&hash=F60C7F501EE53E44C6BFA6BE3AF3A8C0",
    "legacy",
    "Great Lake State - Black",
    "LK"
  ),
  backgroundDesign(
    "legacy_great_lakes",
    "LCY",
    "Great Lakes — Blue",
    "Legacy_GreatLakes.png?mw=768&rev=07d106566bd04e578bde9617f4c1cdd4&hash=87EE11D4D463ACF4985962231BA296D0",
    "legacy",
    "Great Lakes - Blue",
    "LB"
  ),
  backgroundDesign(
    "legacy_semiquincentennial",
    "LCY",
    "Semiquincentennial",
    "Legacy_Semiquincentennial.jpg?mw=768&rev=13fd1e1cc95a4a668156cc919a7946a2&hash=1E086FF6D9A2D5E781ED4C90D4048001",
    "legacy",
    "Semiquincentennial",
    "SQ"
  ),

  ...[
    ["sc_agricultural_heritage", "Agricultural Heritage", "SpecialCause_AgriculturalHeritage.jpg?mw=768&rev=50b9090a3cb2496abffe594b04b1fe98&hash=03B227AEC9D3494BDA69482BF08C6972", "AG"],
    ["sc_breast_cancer", "Breast Cancer Awareness", "SpecialCause_BreastCancerAwareness.jpg?mw=768&rev=3823289e7080497bb2eaaa673e850440&hash=36BD458F5A36982E06D6E357D1B46E66", "BC"],
    ["sc_childrens_trust", "Children Trust Michigan", "SpecialCause_ChildrensTrustFund.jpg?mw=768&rev=bd73893b7a424166b851eb8c856382cd&hash=5294789AB2FE66322B775BC0D02B2087", "CTF"],
    ["sc_detroit_lions", "Detroit Lions", "SpecialCause_DetroitLions.jpg?mw=768&rev=ad3045f71af147b8a83502953fd7891c&hash=A139954CF5B830B4F38E462D33F46A56", "LION"],
    ["sc_detroit_pistons", "Detroit Pistons", "SpecialCause_DetroitPistons.jpg?mw=768&rev=c073a551517e4434acdbb8a2b4559a95&hash=8ADF953A76CEC4165140D15BEBE885B8", "PIS"],
    ["sc_detroit_red_wings", "Detroit Red Wings", "SpecialCause_DetroitRedWings.jpg?mw=768&rev=b7a1473df2e94fbeb68a9d3d80105c05&hash=707713D9A9748DD57A0323F99FF1196E", "RW"],
    ["sc_detroit_tigers", "Detroit Tigers", "SpecialCause_DetroitTigers.jpg?mw=768&rev=bb9d47ad5b274ec9a0710afe3785a41c&hash=5B1800CB1553BD087B0283FCFD565E05", "TGR"],
    ["sc_donate_life", "Donate Life", "SpecialCause_DonateLife.jpg?mw=768&rev=cfa4d2e7a7e94812b2695ad575547cab&hash=EF77603742C3CCB13EDFC7AC6220A295", "DL"],
    ["sc_ducks_unlimited", "Ducks Unlimited", "SpecialCause_DucksUnlimited.jpg?mw=768&rev=4f1bbf6016894010bd24fc901d6d19b1&hash=BF1EEA57AD60D06B1B478D58810632BC", "DU"],
    ["sc_lighthouse", "Lighthouse Preservation", "SpecialCause_LighthousePreservation.jpg?mw=768&rev=e656e9ca471a4e9fa3c71a012c080c02&hash=95A230E4DEA7612A0760230D8D24D0CC", "LH"],
    ["sc_4h", "Michigan 4-H", "SpecialCause_4H.jpg?mw=768&rev=5731046fc14f41fd9c14c3e801e09007&hash=133AD021E3FAF464E457B21445362A2D", "4H"],
    ["sc_olympic", "Olympic Education", "SpecialCause_OlympicEducation.jpg?mw=768&rev=0776715ec1964e9fbcec91bcbb54e727&hash=99F53D223FDC894582B93F730F8F02ED", "OLY"],
    ["sc_patriotic", "Patriotic", "SpecialCause_Patriotic.jpg?mw=768&rev=1df712c576684a74b3a09bde67dd3bc4&hash=8AF7E22D63D629038EBC3C652D97F33C", "P"],
    ["sc_sickle_cell", "Sickle Cell Awareness", "SpecialCause_SickleCell.png?mw=768&rev=330d1c4f0e864a02aeb34ade838d66ad&hash=B01DEB02D63A64A60B2D268BBE069A56", "SC"],
    ["sc_support_veterans", "Support Michigan Veterans", "SpecialCause_SupportMichiganVeterans.jpg?mw=768&rev=f94c51fadc5f4d96abdc9adf4d24fe4d&hash=5346BB320A5414D0F1654F6F48732B54", "MV"],
    ["sc_veterans_memorial", "Veterans Memorial", "SpecialCause_VeteransMemorial.jpg?mw=768&rev=44e2c533236d4eee8163d516a0b631b6&hash=B2CAB02EB67C81714F71B2F1316EE852", "VM"],
    ["sc_water_quality", "Water Quality", "SpecialCause_WaterQuality.jpg?mw=768&rev=c19c343b2931460190dc1d8edd253b43&hash=32AA8BD4D288668E4EED23660BB5F678", "WQ"],
    ["sc_wildlife_habitat", "Wildlife Habitat", "SpecialCause_WildlifeHabitat.jpg?mw=768&rev=fdba3ce298b349ad85c6c914ce510998&hash=095C69CAFA78AC3B8DCD41F4B123E1F8", "WH"],
  ].map(([value, label, image, optionValue]) =>
    subtypeDesign(value, "SC", label, image, "specialCause", optionValue)
  ),

  ...[
    ["u_central_michigan", "Central Michigan University", "University_CentralMichigan.jpg?mw=768&rev=7e4000c5421f48bb9028ebb761c7fe55&hash=E1FEED9616EE3309EBC6E439A87280B7", "CMU"],
    ["u_eastern_michigan", "Eastern Michigan University", "University_EasternMichigan.png?mw=768&rev=5ddcdc89f21e497d9d918c4fdcb27b50&hash=1D9F748A1A173D3119FCA6028854EFB1", "EMU"],
    ["u_ferris_state", "Ferris State University", "University_FerrisState.jpg?mw=768&rev=e262014a9835410091f46594601aa76f&hash=5464DC2C748AAC16B6321CA2E2B1ABAB", "FSU"],
    ["u_grand_valley", "Grand Valley State University", "University_GrandValleyState.jpg?mw=768&rev=e79200bffb344d80b8fffb1d27bb06be&hash=263DF9A0122CD107C8D981FD44A9CDE6", "GVSU"],
    ["u_lake_superior", "Lake Superior State University", "University_LakeSuperiorState.jpg?mw=768&rev=06c163b78cac45f198aa26a6ca0afc8c&hash=BC1933BF7D0E113FE3F691DC34193B79", "LS"],
    ["u_michigan_state", "Michigan State University", "University_MichiganState.jpg?mw=768&rev=e4a0a3b0a116402dad87746aad7ec595&hash=91FECB57CC67BC7EFD526D94B0E9ECC2", "MSU"],
    ["u_michigan_tech", "Michigan Technological University", "University_MichiganTech.jpg?mw=768&rev=7f2c41f68f7748beab80fd5c21595f96&hash=1239725611057164E603FE2470418571", "MTU"],
    ["u_northern_michigan", "Northern Michigan University", "University_NorthernMichigan.jpg?mw=768&rev=c41ec8caca3a423386e0716ad77d2b5e&hash=1FBC9DB27FC9632C0F24C30D44315FD1", "NMU"],
    ["u_oakland", "Oakland University", "University_Oakland.jpg?mw=768&rev=8232bcc731ab43f58c8167038dd38115&hash=CF3BE1396675C2F04F490EEBE734E067", "OU"],
    ["u_saginaw_valley", "Saginaw Valley State University", "University_SaginawValleyState.jpg?mw=768&rev=5e3c8248792a4632aabcc4daad269a57&hash=93EBDDD983805BFAA450A615A280A700", "SVSU"],
    ["u_michigan", "University of Michigan", "University_UMichigan.jpg?mw=768&rev=669918fa6d5845afa10849b16aa108fd&hash=AD099B50EA1D7426CE6EBD7630494B9A", "UM"],
    ["u_michigan_dearborn", "University of Michigan - Dearborn", "University_UMichiganDearborn.jpg?mw=768&rev=4262bde247724958825b2202026824fa&hash=CC348E5BD8FA92BB6744956ABAFF0A7A", "UMD", "University of Michigan- Dearborn"],
    ["u_michigan_flint", "University of Michigan - Flint", "University_UMichiganFlint.jpg?mw=768&rev=424754337696468d9dab8a75d09f1e3f&hash=3F8832B84BB61DD8476773E21EE8EBBE", "UMF", "University of Michigan- Flint"],
    ["u_wayne_state", "Wayne State University", "University_WayneState.jpg?mw=768&rev=8737203448ef46358e5dc9281d75d7c3&hash=D112007E309C1A39D910F1A9E3765772", "WSU"],
    ["u_western_michigan", "Western Michigan University", "University_WesternMichigan.jpg?mw=768&rev=99ff88359d904a669b766b3644f57151&hash=6AD60C3D603227EAF11D2CC6AB39507F", "WMU"],
  ].map(([value, label, image, optionValue, optionLabel]) =>
    subtypeDesign(value, "U", label, image, "university", optionValue, optionLabel)
  ),

  ...[
    ["vt_afghanistan_campaign", "Afghanistan Campaign Medal Veteran", "MilitaryVeterans_AfghanistanCampaignMedal.jpg?mw=768&rev=238ae6c510c440ff89e854fda94ae01b&hash=DE059424625C14D16343AB34D5136EFD", "CMAF"],
    ["vt_afghanistan_conflict", "Afghanistan Conflict Veteran", "MilitaryVeterans_AfghanistanConflict.jpg?mw=768&rev=4025bce24ddf40be91aca1aa945ec7e6&hash=494102A6602FC30593DD43404C58D637", "CVAF"],
    ["vt_air_force", "Air Force Veteran", "MilitaryVeterans_AirForce.jpg?mw=768&rev=a7d50506d86c4091815c8003542dc246&hash=B8E1429E640039737A2DB13C441A2681", "VAF"],
    ["vt_army", "Army Veteran", "MilitaryVeterans_Army.png?mw=768&rev=03a2c990ccec4e6a859f9b8b28c732ec&hash=35EFAEFD72E12D1D8A0136B6520ED6D4", "VAR"],
    ["vt_blue_star", "Blue Star Family", "MilitaryVeterans_BlueStarFamily.jpg?mw=768&rev=e7d58a0543804225a27091474d00ccf9&hash=C2C38BEBC0AF491B8D8BBC04CA854ACE", "BLU"],
    ["vt_coast_guard", "Coast Guard Veteran", "MilitaryVeterans_CoastGuard.jpg?mw=768&rev=d1bd4c5f1e78485eaefc254f10885fb3&hash=E96C0AB3C165CD0A8BA13C2EBA86FA1A", "VCG"],
    ["vt_purple_heart", "Combat Wounded Veteran (Purple Heart)", "MilitaryVeterans_CombatWoundedVeteran.jpg?mw=768&rev=4bb91f1116e342feb954b5a4b8689fe7&hash=512038F775F357D65A4BD511B71FF907", "VCW"],
    ["vt_cuban_missile", "Cuban Missile Crisis", "MilitaryVeterans_CubanMissileCrisis.jpg?mw=768&rev=2a9d7f05661a4d1c8f183097f5eefcf7&hash=5FFA5B9DB583CF1491E01F15412B1564", "CMC"],
    ["vt_disabled_permanent", "Disabled Veteran Permanent", "MilitaryVeterans_PermanentDisabledVeteran.jpg?mw=768&rev=9acbe1d4075c4b18ad67a2322b2a19e1&hash=D39048770CBEDF546DC6E15F59ED12B0", "PDV"],
    ["vt_disabled_standard", "Disabled Veteran Standard", "MilitaryVeterans_StandardDisabledVeteran.jpg?mw=768&rev=3fb36b4720bc4ae0ae8f4fb1e4fab2ee&hash=A183D222E242778BBCED9ED6EAC7782B", "SDV"],
    ["vt_dominican_republic", "Dominican Republic Veteran", "MilitaryVeterans_DominicanRepublic.jpg?mw=768&rev=687bbf90024d472fbc6242bfc826ded3&hash=1753C72836ED961FC790AD8C210B08D9", "VDR"],
    ["vt_ex_pow_permanent", "Ex-Prisoner of War Permanent", "MilitaryVeterans_ExPrisonerofWar.jpg?mw=768&rev=c8bb8cbc9f974f3b818e16a244c69196&hash=7DEEB08125C8870067D82D4E71F81AFB", "PEXP"],
    ["vt_ex_pow_standard", "Ex-Prisoner of War Standard", "MilitaryVeterans_ExPrisonerofWar.jpg?mw=768&rev=c8bb8cbc9f974f3b818e16a244c69196&hash=7DEEB08125C8870067D82D4E71F81AFB", "EXP"],
    ["vt_grenada", "Grenada Conflict Veteran", "MilitaryVeterans_GrenadaConflict.jpg?mw=768&rev=1525f2d30ba24c899be8a51c82dc9ad6&hash=A6CED615682968A88F7DF35684DE6D93", "CVGD"],
    ["vt_iraq_campaign", "Iraq Campaign Medal Veteran", "MilitaryVeterans_IraqCampaignMedal.jpg?mw=768&rev=bc4deb83c8984aca89ed654ac66aef04&hash=635EC5A8BBBF0300315D6B1CF84F793C", "CMIQ"],
    ["vt_iraq_conflict", "Iraq Conflict Veteran", "MilitaryVeterans_IraqConflict.jpg?mw=768&rev=d675102a06b146838f00fec8712e2c82&hash=8B616C02D14234872ECD351AFBFA415D", "CVIQ"],
    ["vt_korean_war", "Korean War Veteran", "MilitaryVeterans_KoreanWar.jpg?mw=768&rev=a6403fe242064b55b03824f748a1b7ee&hash=CF3E606DF6ED3267D5E984B12B72C00A", "VKR"],
    ["vt_laos", "Laos Conflict Veteran", "MilitaryVeterans_LaosConflict.jpg?mw=768&rev=f25a53bb07584b84a91d6b7f353fcbda&hash=F8105E41F668C7685AAC1B1C08EC3A35", "CVLA"],
    ["vt_lebanon", "Lebanon Conflict Veteran", "MilitaryVeterans_LebanonConflict.jpg?mw=768&rev=5c4deb3e205e461983d0d48cf6ca96f5&hash=478E5BFFD9A69099802A83B448DF266A", "CVLB"],
    ["vt_marine_corps", "Marine Corps Veteran", "MilitaryVeterans_MarineCorps.jpg?mw=768&rev=8aade8bc622e4605aed533b65700f80c&hash=3426BCFC043170F5EE6036A2D86F2820", "VMC"],
    ["vt_merchant_marine", "Merchant Marine", "MilitaryVeterans_MerchantMarine.jpg?mw=768&rev=75b7876d897944baba5feba3b5e1853f&hash=415D53154FAE548EA4FA8B0D832A50B2", "VMM"],
    ["vt_military_reserve", "Military Reserve Member", "MilitaryVeterans_MilitaryReserve.jpg?mw=768&rev=95bfc46e26494f669e4b5deff254ac27&hash=116ED5211EBE83E0BFD2C8DC370E22C1", "MMR"],
    ["vt_national_guard", "National Guard Member", "MilitaryVeterans_NationalGuard.jpg?mw=768&rev=46ba0633cc4d4c0a9761f58850ca4257&hash=9A5C8EA0053E1DDA00946E87319E58C7", "MNG"],
    ["vt_navy", "Navy Veteran", "MilitaryVeterans_Navy.jpg?mw=768&rev=42ce476a62d941ddab6dbc908ab99dca&hash=369EF8573F60F9B65B86E207959999C5", "VN"],
    ["vt_panama", "Panama Conflict Veteran", "MilitaryVeterans_PanamaConflict.jpg?mw=768&rev=b58b733483364f00b559aa7da4f7b06b&hash=2BE42E5B34B200E111F82A90A4594928", "CVPA"],
    ["vt_pearl_harbor", "Pearl Harbor Survivor", "MilitaryVeterans_PearlHarborSurvivor.jpg?mw=768&rev=d9d22d6965c445909695658d57bdc16d&hash=1AFBBA2DBD9642231E13EE42A6702E57", "SPH"],
    ["vt_persian_gulf", "Persian Gulf Veteran (Desert Storm)", "MilitaryVeterans_PersianGulfDesertStorm.jpg?mw=768&rev=791bf18d134d4851b2ce3596145dc9aa&hash=F555C3A60501F5CD87E29F51A70F2D70", "VPG"],
    ["vt_somalia", "Somalia Conflict Veteran", "MilitaryVeterans_SomaliaConflict.jpg?mw=768&rev=12cacc19cec84fccbb53ea2907bceed7&hash=982BE6FE53F1CFC78B0EBA562357F181", "VSO"],
    ["vt_vietnam_service", "Vietnam Service Medal Veteran", "MilitaryVeterans_VietnamServiceMedal.jpg?mw=768&rev=e8561b79eaed4ad3b9b5e8264d732af0&hash=000FAFC4F6B71447779E2A3090FED012", "SMVN"],
    ["vt_vietnam_war", "Vietnam War Veteran", "MilitaryVeterans_VietnamWar.jpg?mw=768&rev=6b33448adaee41f489cda1ba3579258b&hash=F391E5D8795FC9F2948FF9BCC0B42527", "VVN"],
    ["vt_woman", "Woman Veteran", "MilitaryVeterans_WomanVeteran.jpg?mw=768&rev=52d0f2413c054faaa45242b5701cfeb9&hash=5E30FA1F4DFAE4F4A6A9F8E325B54480", "WOV"],
    ["vt_world_war_ii", "World War II Veteran", "MilitaryVeterans_WorldWarII.jpg?mw=768&rev=50ee4b3200a9497787444d26eeb19b2b&hash=9AA1FD90B516C629E7613CBB955BBC19", "VWW2"],
  ].map(([value, label, image, optionValue]) =>
    subtypeDesign(value, "VT", label, image, "military", optionValue)
  ),

  makeDesign({
    value: "gld_gold_star_family",
    plateType: "GLD",
    label: "Gold Star Family",
    image: "MilitaryVeterans_GoldStarFamily.jpg?mw=768&rev=a080739436ad4f148d06f6b85f12a01b&hash=99A962ACB6AE38F049E94FE6FCAA5BAC",
    source: "military",
    selection: STANDARD_WHITE,
  }),
  makeDesign({
    value: "aro_amateur_radio",
    plateType: "ARO",
    label: "Amateur Radio Operator",
    image: AMATEUR_RADIO_GALLERY,
    source: "organization",
    selection: { field: "Plate Background", optionLabel: "Standard White", optionValue: "PM" },
  }),

  makeDesign({
    value: "consul_standard_white",
    plateType: "CONSUL",
    label: "Honorary Consul · Standard White",
    image: STANDARD_WHITE_GALLERY,
    source: "industry",
    selection: { field: "Plate Background", optionLabel: "Standard White", optionValue: "PM" },
  }),
  makeDesign({
    value: "commercial_standard_white",
    plateType: "COM",
    label: "Commercial · Standard White",
    image: STANDARD_WHITE_GALLERY,
    source: "industry",
    selection: { field: "Plate Background", optionLabel: "Standard White", optionValue: "PMB" },
  }),
  makeDesign({
    value: "commercial_mackinac_bridge",
    plateType: "COM",
    label: "Commercial · Mackinac Bridge",
    image: MACKINAC_GALLERY,
    source: "industry",
    selection: { field: "Plate Background", optionLabel: "Mackinac Bridge", optionValue: "BR" },
  }),
  makeDesign({
    value: "fleet_standard_white",
    plateType: "FLT",
    label: "Fleet · Standard White",
    image: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.FLT.PM",
    source: "industry",
    selection: { field: "Plate Background", optionLabel: "Standard White", optionValue: "PM" },
  }),
  makeDesign({
    value: "rental_fleet_standard_white",
    plateType: "RFL",
    label: "Rental Fleet · Standard White",
    image: "https://dsvsesvc.sos.state.mi.us/TAP/Image/ENG/MM.RFL.PM.png",
    source: "industry",
    selection: { field: "Plate Background", optionLabel: "Standard White", optionValue: "PM" },
  }),

  ...[
    ["pso_alpha_phi_alpha", "Alpha Phi Alpha", "SpecialOrg_AlphaPhiAlpha.jpg?mw=768&rev=7c79d309cca94676ae682bc762fbc3cd&hash=D34DAE26553C31556A441013EA7E72EE", "APA"],
    ["pso_delta_sigma_theta", "Delta Sigma Theta", "SpecialOrg_DeltaSigmaTheta.jpg?mw=768&rev=ac87055f6bd6479d90c3a4923c76b1ac&hash=7A4703D63A4DD7F87B282CC88D47462D", "DST"],
    ["pso_fire_fighters", "Michigan Professional Fire Fighters Union", "SpecialOrg_ProfessionalFireFightersUnion.jpg?mw=768&rev=b516c659949e4fdb88f2b3ad60980fe8&hash=729243B1BA90803E826CCC86063A6892", "FF", "Fire Fighters Union"],
    ["pso_fraternal_order_police", "Michigan Fraternal Order of Police", "SpecialOrg_FraternalOrderofPolice.jpg?mw=768&rev=2a0e58f47bf74547bc32bcab88d5513a&hash=F1D488C53834B2C20E9EFE484927BBDA", "FOP", "Fraternal Order of Police"],
    ["pso_kappa_alpha_psi", "Kappa Alpha Psi", "SpecialOrg_KappaAlphaPsi.jpg?mw=768&rev=1e68938c4dee47bcb59b64728fc67ace&hash=76F4D5A4F13884E840B47CE75E288679", "KAP"],
    ["pso_masons", "Grand Lodge of Free and Accepted Masons of Michigan", "SpecialOrg_Freemasons.jpg?mw=768&rev=e3f69de2a02349d58420c261dcfb29ce&hash=3AD8DD63CE09A5DFD5A521BD3EDF9643", "MAS", "Masons"],
    ["pso_michigan_firemen", "Michigan State Firemen's Association", "SpecialOrg_FiremensAssociation.jpg?mw=768&rev=327dad11cdfd4c31b3fd461455a50d56&hash=826AEBD6BFC58442572C4EE14E623A94", "MFM", "Michigan Firemen"],
    ["pso_phi_beta_sigma", "Phi Beta Sigma", "SpecialOrg_PhiBetaSigma.jpg?mw=768&rev=367e95dc67984e30bc2e58264ab6f638&hash=DB934EBEAA878A47CF4A1B2B6024DCBF", "PBS"],
    ["pso_poam", "Police Officers Association of Michigan", "SpecialOrg_POAM.jpg?mw=768&rev=33da31e84ca3487b952468947f719138&hash=209D37A08F91375310DE6B689E3AC969", "PSA"],
    ["pso_zeta_phi_beta", "Zeta Phi Beta", "SpecialOrg_ZetaPhiBeta.jpg?mw=768&rev=926fa97209124df193fcf758e2ad9cbb&hash=4C28F801DA322AEA0C4FE8CC7438E0F7", "ZPB"],
  ].map(([value, label, image, optionValue, optionLabel]) =>
    subtypeDesign(value, "PSO", label, image, "organization", optionValue, optionLabel)
  ),
];

export const SOS_PLATE_DESIGNS = Object.freeze(
  Object.fromEntries(DESIGNS.map((design) => [design.value, design]))
);

export function plateDesignByValue(value) {
  return SOS_PLATE_DESIGNS[String(value || "")] || null;
}

export function plateDesignsForType(plateType) {
  return DESIGNS.filter((design) => design.plateType === plateType);
}

export function plateDesignOptionsForType(plateType) {
  return plateDesignsForType(plateType).map((design) => [design.value, design.label]);
}

export function plateSubmissionFields(design) {
  if (!design?.selection) return [];
  const selections = [design.selection, design.background].filter(Boolean);
  return selections.map((selection) => ({
    label: selection.field,
    kind: "select",
    optionValue: selection.optionValue,
    optionLabel: selection.optionLabel,
  }));
}
