                    MEDICINE E-COMMERCE PLATFORM
                              (Core Idea)

 ┌─────────────────────────────────────────────────────────────┐
 │                         CUSTOMERS                           │
 │                                                             │
 │  Patients • Families • Elderly • Clinics • Pharmacies      │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    ONLINE PLATFORM                          │
 │                                                             │
 │  Web App (Next.js) + Mobile App + Admin Dashboard           │
 └─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼

┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ PRODUCT SYSTEM  │   │ PRESCRIPTION    │   │ ORDER SYSTEM    │
│                 │   │ MANAGEMENT      │   │                 │
│ - OTC Medicines │   │                 │   │ - Cart          │
│ - Prescription  │   │ - Upload Rx     │   │ - Checkout      │
│   Medicines     │   │ - Pharmacist    │   │ - Payment       │
│ - Search        │   │   Review        │   │ - Delivery      │
│ - Categories    │   │ - Approval      │   │ - Tracking      │
└─────────────────┘   └─────────────────┘   └─────────────────┘

        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                  PHARMACIST VALIDATION                      │
 │                                                             │
 │  Verify Prescriptions • Suggest Alternatives • Safety Check │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 INVENTORY + SUPPLIERS                       │
 │                                                             │
 │  Stock • Expiry Dates • Batch Tracking • Suppliers         │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                   DELIVERY + LOGISTICS                      │
 │                                                             │
 │  Same Day • Scheduled • Cold Chain • Pickup Options        │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 LEGAL + COMPLIANCE LAYER                    │
 │                                                             │
 │  Prescription Laws • Audit Logs • Security • Privacy       │
 └─────────────────────────────────────────────────────────────┘


                  ONLINE PHARMACY MARKETPLACE PLATFORM
                      (Client ↔ Pharmacist Model)

 ┌─────────────────────────────────────────────────────────────┐
 │                         CUSTOMERS                           │
 │                                                             │
 │   Patients • Families • Elderly • Chronic Patients         │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    ONLINE PLATFORM                          │
 │                                                             │
 │        Web App + Mobile App + Admin Dashboard              │
 │                                                             │
 │   Platform does NOT own medicine stock                     │
 │   Platform connects customers with pharmacies              │
 └─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼

┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ CUSTOMER SIDE   │   │ PRESCRIPTION    │   │ PHARMACY SIDE   │
│                 │   │ MANAGEMENT      │   │                 │
│ - Search Meds   │   │                 │   │ - Receive Orders│
│ - Compare Price │   │ - Upload Rx     │   │ - Validate Rx   │
│ - Nearby Pharma │   │ - Review        │   │ - Confirm Stock │
│ - Add to Cart   │   │ - Approval      │   │ - Prepare Order │
│ - Checkout      │   │ - Pharmacist    │   │ - Dispatch      │
└─────────────────┘   │   Validation    │   └─────────────────┘
                      └─────────────────┘

        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                  PHARMACY NETWORK                           │
 │                                                             │
 │   Registered Pharmacies + Licensed Pharmacists             │
 │                                                             │
 │   Multiple pharmacies sell through one platform            │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 DELIVERY SYSTEM                             │
 │                                                             │
 │   Pharmacy Delivery • Courier • Pickup • Emergency Orders  │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                PLATFORM REVENUE MODEL                       │
 │                                                             │
 │   Commission per Order                                      │
 │   Delivery Fees                                             │
 │   Featured Pharmacy Listings                                │
 │   Subscription for Pharmacies                               │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │              LEGAL + TRUST + COMPLIANCE                     │
 │                                                             │
 │   License Verification • Audit Logs • Privacy              │
 │   Prescription Control • Anti-Fraud • Security            │
 └─────────────────────────────────────────────────────────────┘

                     PHARMACY NETWORK SYSTEM
                 (Inside the Pharmacy Network)

 ┌─────────────────────────────────────────────────────────────┐
 │                    PHARMACY NETWORK                         │
 │                                                             │
 │      Multiple Registered Pharmacies on One Platform        │
 └─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼

┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│ PHARMACY        │   │ PHARMACIST      │   │ MEDICINE        │
│ REGISTRATION    │   │ MANAGEMENT      │   │ CATALOG         │
│                 │   │                 │   │                 │
│ - License Verify│   │ - Licensed Staff│   │ - OTC Medicines │
│ - Legal Docs    │   │ - Role Access   │   │ - Rx Medicines  │
│ - Business Info │   │ - Shift Status  │   │ - Brands        │
│ - Location      │   │ - Availability  │   │ - Generic Drugs │
│ - Working Hours │   │ - Validation    │   │ - Dosage Info   │
└─────────────────┘   └─────────────────┘   │ - Alternatives  │
                                            └─────────────────┘

        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                   STOCK AVAILABILITY                        │
 │                                                             │
 │  Real-Time Stock Status from Each Pharmacy                 │
 │                                                             │
 │  - Available / Out of Stock                                │
 │  - Quantity Limits                                          │
 │  - Reserved Orders                                          │
 │  - Near Expiry Alerts                                       │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                    PRICE MANAGEMENT                         │
 │                                                             │
 │  Each Pharmacy Controls Its Own Pricing                    │
 │                                                             │
 │  - Product Price                                            │
 │  - Promotions                                                │
 │  - Discounts                                                 │
 │  - Insurance Pricing                                         │
 │  - Emergency Pricing                                         │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                  ORDER ACCEPTANCE FLOW                      │
 │                                                             │
 │  - Receive Customer Order                                   │
 │  - Validate Prescription                                    │
 │  - Confirm Availability                                     │
 │  - Accept / Reject Order                                    │
 │  - Suggest Alternative Medicine                             │
 │  - Prepare for Delivery                                     │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 PHARMACY PERFORMANCE                        │
 │                                                             │
 │  - Ratings                                                  │
 │  - Delivery Speed                                           │
 │  - Success Rate                                             │
 │  - Prescription Accuracy                                    │
 │  - Customer Reviews                                         │
 │  - Compliance Score                                         │
 └─────────────────────────────────────────────────────────────┘

                      ORDER LIFECYCLE SYSTEM
                  (Medicine Marketplace Flow)

 ┌─────────────────────────────────────────────────────────────┐
 │                    CUSTOMER SEARCH                          │
 │                                                             │
 │  Search Medicine • Compare Pharmacies • View Availability  │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                     ADD TO CART                             │
 │                                                             │
 │  Select Medicine • Quantity • Delivery Option              │
 │  Prescription Medicines marked as Rx Required              │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                PRESCRIPTION CHECK                           │
 │                                                             │
 │  OTC Product → Skip                                         │
 │  Rx Product → Upload Prescription                          │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │               PHARMACIST VALIDATION                         │
 │                                                             │
 │  Review Prescription                                        │
 │  Approve / Reject / Request Clarification                  │
 │  Suggest Alternative Medicine if needed                    │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │              PHARMACY STOCK CONFIRMATION                    │
 │                                                             │
 │  Confirm Availability                                       │
 │  Reserve Items                                              │
 │  Confirm Final Price                                        │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                    PAYMENT STEP                             │
 │                                                             │
 │  COD / Card / Wallet / Insurance Support                   │
 │  Payment Success or Failure                                │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                  ORDER PREPARATION                          │
 │                                                             │
 │  Pharmacy Packs Order                                       │
 │  Labeling • Safety Check • Cold Chain if Needed            │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 DELIVERY / PICKUP                           │
 │                                                             │
 │  Courier Dispatch                                           │
 │  Home Delivery / Store Pickup                              │
 │  Real-Time Tracking                                         │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 ORDER COMPLETION                            │
 │                                                             │
 │  Delivered • Confirmed • Refill Reminder                   │
 │  Rating + Review + Invoice                                 │
 └─────────────────────────────────────────────────────────────┘
                              │
                              ▼

 ┌─────────────────────────────────────────────────────────────┐
 │                 POST-ORDER SERVICES                         │
 │                                                             │
 │  Returns Policy • Support • Refunds                        │
 │  Refill Subscription • Chronic Care Reminder               │
 └─────────────────────────────────────────────────────────────┘