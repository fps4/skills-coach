---
title: Image Segmentation with PyTorch
summary: Segmentation as per-pixel classification — U-Net and its alternatives, losses and metrics under class imbalance, augmentation, the training loop, transfer learning, post-processing, and taking a model to production.
---

## Frame

This guide covers semantic image segmentation from the angle of an engineer who builds and ships
the ML system around a model and works alongside data scientists on the model itself. The running
example is a hard but common case: **thin, elongated targets that occupy a tiny fraction of the
image** — contrails in ground sky-camera imagery, cracks in inspection photos, vessels in medical
scans.

Three mental models:

1. **Segmentation is per-pixel classification, and everything follows from that.** A classifier says
   "there is a contrail in this image." A segmentation model says "*these exact pixels* are
   contrail." One label per pixel instead of per image drives the whole stack: the encoder-decoder
   shape, the pixel-wise loss (BCE + Dice), the region metrics (IoU/Dice, not accuracy), and the
   post-processing that turns a mask into "coverage %" and "object count".
2. **Class imbalance dominates the design.** When the target is 1–3% of pixels, "predict all
   background" scores ~98% accuracy and is useless. Loss and metrics must be chosen so that it scores
   badly.
3. **A prototype proves the architecture; name its boundary.** A small model trained on synthetic
   data at low resolution can exercise every layer of the system — UI, backend, model service,
   post-processing — without saying anything about generalization to real imagery. Being explicit
   about that boundary is part of the engineering.

---

## 1. The segmentation problem

### 1a. Classification vs detection vs segmentation

| Task | Output | Example |
|---|---|---|
| **Classification** | One label per image | "This frame contains a contrail (0.87)" |
| **Object detection** | Bounding boxes + labels | "Contrail in box (x,y,w,h)" — boxes fit thin diagonal lines badly |
| **Semantic segmentation** | One class per **pixel** | Every pixel is contrail / not-contrail — a binary mask |
| **Instance segmentation** | Per-pixel mask **per object** | Contrail #1's pixels, contrail #2's pixels, separately |

For a thin diagonal structure a **bounding box is mostly background**; per-pixel segmentation is the
natural representation.

### 1b. Semantic vs instance segmentation

- **Semantic** — pixels get a *class*. Two overlapping objects become one blob.
- **Instance** — pixels get a *class* **and** an *instance id*. Two objects stay distinct, each with
  its own mask — what you need to **count and track individual objects over time**.

Tracking an object across video frames (does it persist, spread, dissipate?) is an *instance*
problem: you must know which object is which from frame to frame. A semantic model is a starting
point; counting and tracking reliably needs instance segmentation plus temporal tracking.

### 1c. A reference system shape

```
UI (upload image,          ──HTTP──▶  Backend-for-frontend   ──HTTP──▶  ML service
 render mask overlay,                  (validation,                    (PyTorch U-Net inference:
 coverage % + count)                   orchestration, no ML)           mask → coverage % + count)
```

The model sits isolated behind a clean HTTP boundary; the backend-for-frontend does validation and
orchestration with no ML. **Synthetic training data** — procedurally generated images with
ground-truth masks for free — lets such a system train and run on a laptop with no labelling or
licensing burden, but it proves the pipeline, not generalization to real imagery.

---

## 2. Architectures: U-Net, FCN, DeepLab

### 2a. The encoder-decoder idea

- **Encoder (contracting path)** — convolutions + downsampling (pooling / strided conv). Shrinks the
  spatial size (128→64→32→16) while growing feature depth. Learns *what* is in the image and throws
  away *where, exactly*.
- **Decoder (expanding path)** — upsampling + convolutions back to full resolution, turning the
  compressed features into a per-pixel prediction.

Downsampling destroys the fine spatial detail needed to place a *thin* target precisely. Skip
connections fix that.

### 2b. U-Net and skip connections

**U-Net** (Ronneberger et al., 2015 — biomedical origin) is the encoder-decoder with **skip
connections**: at each decoder level, the feature map is **concatenated with the same-resolution
encoder feature map** before convolving. The encoder's high-resolution features (sharp edges, exact
positions) are re-injected so the mask has crisp boundaries.

```
128 ─┐(skip)────────────────────▶ 128   output mask
  64 ─┐(skip)──────────────▶ 64
    32 ─┐(skip)────────▶ 32
      16 ──── bottleneck ────▶ 16
```

Why U-Net is the default for thin targets:

- **Thin, high-detail targets** need the precise localization of skip connections; without them a
  2-pixel-wide line comes out as a blurry smear.
- **Small datasets** — U-Net was designed to train well on limited annotated data.
- It is the workhorse the field starts from.

### 2c. FCN and DeepLab

| Architecture | Idea | When it wins |
|---|---|---|
| **FCN** (2015) | Replace the dense classifier head with convolutions + upsampling. Coarser output. | Historical baseline; the ancestor |
| **U-Net** | Encoder-decoder + **skip connections** | Small data, thin or boundary-sensitive targets |
| **DeepLab** (v3 / v3+) | **Atrous (dilated) convolutions** + **ASPP** (Atrous Spatial Pyramid Pooling: parallel dilated convolutions at several rates) for multi-scale context **without losing resolution** | Large scenes, multi-scale objects, large datasets |

A reasonable decision rule: U-Net for thin, boundary-sensitive targets on limited data; benchmark
against DeepLabv3+ or a U-Net with a pretrained backbone once more data exists. Transformer models
(SegFormer, Mask2Former, SAM) are where the field is heading, especially for instance segmentation.

### 2d. A minimal U-Net block

```python
import torch
import torch.nn as nn

class DoubleConv(nn.Module):
    """(conv → BN → ReLU) × 2 — the repeating unit at every U-Net level."""
    def __init__(self, in_ch, out_ch):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.block(x)

class Up(nn.Module):
    """Upsample, then concat the encoder skip, then DoubleConv."""
    def __init__(self, in_ch, skip_ch, out_ch):
        super().__init__()
        self.up = nn.ConvTranspose2d(in_ch, in_ch // 2, kernel_size=2, stride=2)
        self.conv = DoubleConv(in_ch // 2 + skip_ch, out_ch)

    def forward(self, x, skip):
        x = self.up(x)
        x = torch.cat([x, skip], dim=1)   # <-- the skip connection
        return self.conv(x)
```

The two lines that carry the idea: `DoubleConv`, the repeating conv-BN-ReLU unit, and
`torch.cat([x, skip], dim=1)`, the skip connection concatenating along the channel dimension.

---

## 3. Loss functions

### 3a. The class-imbalance problem

A thin target might be **1–3% of the pixels**. A model predicting "everything is background" scores
**~98% pixel accuracy** and never finds a target. Loss and metrics must make that a bad score.

### 3b. The loss zoo

| Loss | Optimizes | Under thin-target imbalance |
|---|---|---|
| **BCE** (binary cross-entropy) | Per-pixel probability correctness | Stable gradients, but the background dominates the sum — drifts towards predicting background |
| **Dice loss** | **Overlap** of predicted and true mask (`1 − Dice`) | Region-based; a few positive pixels matter as much as the whole background |
| **BCE + Dice** | Both — pixel calibration **and** region overlap | Robust; standard for medical and thin-structure segmentation |
| **Focal loss** | BCE **down-weighted on easy pixels** (`(1−p)^γ`) | Focuses learning on hard and rare pixels |
| **Tversky / Focal-Tversky** | Dice with **tunable false-positive vs false-negative weights** (α, β) | Raise β when missing a target is worse than a false alarm |

### 3c. Dice and the combined loss

```python
class DiceLoss(nn.Module):
    """Soft Dice on probabilities. 1 - (2|A∩B| + eps) / (|A| + |B| + eps)."""
    def __init__(self, eps: float = 1e-6):
        super().__init__()
        self.eps = eps

    def forward(self, logits, targets):
        probs = torch.sigmoid(logits)
        probs = probs.view(probs.size(0), -1)
        targets = targets.view(targets.size(0), -1).float()
        inter = (probs * targets).sum(dim=1)
        union = probs.sum(dim=1) + targets.sum(dim=1)
        dice = (2 * inter + self.eps) / (union + self.eps)
        return 1.0 - dice.mean()

class BCEDiceLoss(nn.Module):
    def __init__(self, dice_weight: float = 1.0):
        super().__init__()
        self.bce = nn.BCEWithLogitsLoss()   # takes logits, not sigmoid output
        self.dice = DiceLoss()
        self.dice_weight = dice_weight

    def forward(self, logits, targets):
        return self.bce(logits, targets) + self.dice_weight * self.dice(logits, targets)
```

Two details: the loss takes **logits** and uses `BCEWithLogitsLoss` (the sigmoid folded in for
numerical stability — never sigmoid then plain BCE), and **`eps`** in Dice avoids division by zero on
all-background patches.

---

## 4. Metrics

### 4a. IoU, Dice, and why not accuracy

| Metric | Definition | Reads as |
|---|---|---|
| **Pixel accuracy** | correct pixels / total pixels | **Misleading** under imbalance; never a headline |
| **IoU / Jaccard** | \|A∩B\| / \|A∪B\| | The standard segmentation metric |
| **Dice / F1** | 2\|A∩B\| / (\|A\|+\|B\|) | F1 on the pixel set; more generous to overlap |

IoU and Dice are **monotonically related** (Dice ≥ IoU; both 0→1). Dice is more forgiving on small
objects. Track both on the target class, plus **precision** (is the model crying wolf?) and
**recall** (is it missing faint targets?).

### 4b. Evaluation subtleties

- **Threshold choice** — the model outputs probabilities; sweep the binarization threshold on a
  **validation set** (to maximize Dice or hit a target recall) rather than taking 0.5.
- **Per-image vs aggregate** — averaging Dice per image and pooling all pixels give different
  numbers (mean of ratios versus ratio of sums); be consistent.
- **Empty-mask images** — on a frame with no target, Dice is undefined (or 1.0 for a correct empty
  prediction); fix the convention up front.

---

## 5. Data augmentation

With small datasets, augmentation is how you avoid overfitting and buy the invariances you want.

- **Geometric** — flips, rotations, random crops, scale jitter. **Apply the identical transform to
  image and mask**; rotating one without the other destroys the ground truth.
- **Photometric** — brightness, contrast, gamma, hue shifts for lighting, time of day and haze.
  **Image only**, never the mask.
- **Noise / blur** — Gaussian noise, motion blur for camera and atmospheric conditions.
- **Albumentations** — the standard library for segmentation; it transforms image and mask together
  in one call.

```python
import albumentations as A
train_aug = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.RandomRotate90(p=0.5),
    A.RandomBrightnessContrast(p=0.3),   # image only; mask untouched
    A.GaussNoise(p=0.2),
])
out = train_aug(image=img, mask=mask)   # image and mask stay in sync
```

A synthetic data generator is itself aggressive augmentation: effectively unlimited (image, mask)
pairs with varied backgrounds and target geometry.

---

## 6. The training loop

### 6a. Anatomy

```python
def train_one_epoch(model, loader, loss_fn, optimizer, scaler, device):
    model.train()
    for images, masks in loader:
        images, masks = images.to(device), masks.to(device)
        optimizer.zero_grad()                         # 1. clear old gradients
        with torch.autocast(device_type="cuda"):      # mixed precision
            logits = model(images)                    # 2. forward
            loss = loss_fn(logits, masks)             #    loss
        scaler.scale(loss).backward()                 # 3. backward (scaled for fp16)
        scaler.step(optimizer)                        # 4. step
        scaler.update()
    return loss.item()
```

- **`optimizer.zero_grad()`** — PyTorch *accumulates* gradients; clear them each step or they sum
  across batches.
- **`loss.backward()`** — autograd computes the gradient of the loss for every parameter.
- **`optimizer.step()`** — applies the update (Adam/AdamW is usual for U-Net).
- **`model.train()` vs `model.eval()`** — toggles BatchNorm and Dropout behaviour; forgetting
  `model.eval()` (and `torch.no_grad()`) at inference is the most common beginner bug.

### 6b. LR schedule, early stopping, mixed precision

- **Learning-rate schedule** — start higher, decay: **cosine annealing** or **ReduceLROnPlateau**
  (drop LR when validation Dice stalls), with a few warmup epochs.
- **Early stopping** — stop when validation Dice/IoU has not improved for *N* epochs (patience);
  keep the best checkpoint.
- **Mixed precision (AMP)** — compute in fp16 where safe with an fp32 master copy; roughly 2× faster
  at half the memory on GPU. **`GradScaler`** scales the loss so small fp16 gradients do not
  underflow to zero.
- **Train / validation / test split** — choose the model on validation, report on a held-out test
  set. With synthetic training data, generalization to real imagery is the untested axis.

---

## 7. Transfer learning and resolution

### 7a. Pretrained encoders

In production you almost always swap the encoder for a **pretrained backbone** — ResNet,
EfficientNet — trained on ImageNet, and fine-tune. The encoder already knows edges, textures and
gradients, so it needs **far fewer labels** and converges faster: the biggest lever when real labels
are scarce.

```python
import segmentation_models_pytorch as smp
model = smp.Unet(
    encoder_name="efficientnet-b0",
    encoder_weights="imagenet",
    in_channels=3,
    classes=1,
)
```

### 7b. Resolution vs throughput

Compute scales roughly with pixel count: 128² is ~16× cheaper than 512² and ~64× cheaper than 1024².

| Resolution | Effect |
|---|---|
| **Low (128)** | Fast, small memory, laptop-friendly — but **thin structures vanish** when downsampled |
| **High (512/1024+)** | Preserves thin structures and sharp boundaries; needs GPU and memory |

Low resolution is a speed choice, not a fidelity choice. The alternative to brute-force high
resolution is **tiling**: cut large frames into patches, segment each, stitch the masks back.

---

## 8. Inference and post-processing

The model output is a **probability map**, not an answer:

1. **Threshold** — binarize (e.g. > 0.5).
2. **Morphology** — **opening** (erode then dilate) removes speckle and small false positives;
   **closing** (dilate then erode) bridges small gaps in a broken line.
3. **Connected components** — label contiguous blobs; **component count = object count**; drop
   components below a minimum area.
4. **Coverage %** — the fraction of pixels above threshold.

```python
import numpy as np, cv2
prob = torch.sigmoid(model(x)).squeeze().cpu().numpy()
mask = (prob > 0.5).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n_labels, _ = cv2.connectedComponents(mask)
count = n_labels - 1                      # minus the background label
coverage_pct = 100.0 * mask.mean()
```

Counting on a semantic mask is a **heuristic that under-counts**: two crossing objects merge into one
component. Instance segmentation and tracking fix that.

---

## 9. From prototype to production

| Prototype | Production |
|---|---|
| Synthetic image/mask generator | Real annotated imagery (often instance-level video), possibly several modalities (visible + infrared) |
| Semantic (binary) mask | **Instance segmentation + temporal tracking** |
| Low-resolution laptop model | Higher-resolution or **tiled** inference on GPU |
| Trained from scratch | **Transfer learning** on pretrained backbones, fine-tuned on real labels |
| Notebook evaluation | **Experiment tracking + model registry** (e.g. MLflow): runs, parameters, metrics, versioned models promoted dev → prod |
| `python train.py` by hand | Reproducible training pipeline with registered artefacts |
| Service run locally | Containerized model service on a Kubernetes platform, same UI / BFF / ML split |
| Eyeballing outputs | **Monitoring**: input drift (new seasons, cameras, conditions) and performance drift, triggering retraining |

Class imbalance is handled beyond the loss as well: sample patches that contain the target, augment,
use focal or Tversky losses, and tune the threshold on validation to hit a target recall.

---

## Review questions

1. **Why U-Net for thin targets rather than a box detector?** Boxes are mostly background; skip
   connections give precise boundaries; U-Net trains well on small data.
2. **What do skip connections do?** Concatenate high-resolution encoder features into the decoder so
   localization survives downsampling.
3. **Why BCE + Dice?** BCE alone is swamped by background; Dice handles imbalance; BCE keeps
   probabilities calibrated. Tversky if false negatives hurt most.
4. **98% pixel accuracy — good?** Not under imbalance; report IoU and Dice on the target class plus
   precision/recall.
5. **Mask to count?** Threshold → morphology → connected components; crossing objects merge.
6. **One training step?** `zero_grad` → forward → loss → `backward` → `step`.
7. **Why not just raise the resolution?** Cost scales with pixels; tiling keeps detail at lower cost.

---

## Further reading

- Ronneberger, Fischer & Brox, *"U-Net: Convolutional Networks for Biomedical Image Segmentation"*
  (2015).
- Chen et al., DeepLabv3 / DeepLabv3+ papers.
- `segmentation-models-pytorch` and Albumentations docs.
- PyTorch docs on automatic mixed precision.
- Related: [Model Serving Patterns](./model-serving-patterns.md) for serving and drift monitoring.
