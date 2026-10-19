---
title: Machine Learning and Deep Learning for Product Builders
summary: Enough ML to make product decisions — learning paradigms, task types, algorithm families and when each fits, overfitting, deep learning architectures, and adapting foundation models.
---

## Frame

A product builder does not need to derive backpropagation. They need to know which kind of learning
fits a problem, roughly how much data it wants, what it will cost to run, how it fails and how to
tell a credible plan from an expensive one. This guide is that level.

Three mental models:

1. **A model is a function learned from examples.** Training adjusts the function's parameters until
   its outputs match known answers on past data. Everything depends on the future looking like the
   examples.
2. **Generalisation is the only thing that matters.** Scoring well on the training data is easy; the
   question is how the model does on data it has never seen. That is why data is split, and why a
   model that is too good on training data is suspect.
3. **Match the algorithm to the data's shape.** Tables of numbers and categories favour tree
   ensembles; images, audio and text favour deep networks; open-ended language tasks favour
   foundation models. Most of choosing an approach is recognising the shape.

---

## 1. What learning means

- **Features** — the inputs (age, amount, pixels, words). **Label** or **target** — the answer to
  learn (fraud or not, price, the next word).
- **Training** — fit parameters to minimise a **loss**, a number measuring how wrong predictions are.
- **Splits** — a **training set** to fit on, a **validation set** to tune choices on, and a **test
  set** touched once at the end to estimate real performance.
- **The core assumption** — training and future data come from the same distribution. When the world
  changes (new products, new fraud patterns, a pandemic), the model degrades. This is **drift**.

---

## 2. Learning paradigms

| Paradigm | Learns from | Product examples |
|---|---|---|
| **Supervised** | Inputs paired with known answers | Spam detection, price prediction, document classification |
| **Unsupervised** | Inputs only, finding structure | Customer segments, anomaly detection, topic discovery |
| **Self-supervised** | Raw data where part of the input is the answer (predict the masked or next word) | Pre-training of language and vision foundation models |
| **Reinforcement** | Trial, action and reward over time | Game playing, robotics, tuning a model's behaviour from human preferences |
| **Semi- / weakly supervised** | A few labels plus many unlabelled examples, or noisy labels from rules | Bootstrapping when labelling is expensive |

**Bandits** are the product-friendly corner of reinforcement learning: choose between options
(headlines, offers, recommendations), observe the reward, shift traffic toward what works while
still exploring.

---

## 3. Task types

Name the task first; it decides the algorithms, the metrics and the data you need.

- **Classification** — which category? Binary (fraud / not) or multi-class (which department).
- **Regression** — what number? (delivery time, price, demand).
- **Ranking and recommendation** — which items, in what order, for this user?
- **Clustering** — which items are alike, with no categories given in advance?
- **Anomaly detection** — which items are unusual?
- **Forecasting** — what will this time series do next?
- **Detection and segmentation** — where in the image is the object, which pixels belong to it?
- **Generation** — produce text, images, code or audio.
- **Extraction** — pull structured fields out of unstructured documents.

---

## 4. Algorithm families

| Family | How it works | Strengths | Weaknesses |
|---|---|---|---|
| **Linear and logistic regression** | Weighted sum of features | Fast, interpretable, a strong baseline | Misses interactions and non-linear patterns unless engineered |
| **Decision tree** | A learned flowchart of if/then splits | Readable, handles mixed data | Overfits alone; unstable |
| **Random forest** | Many trees on random subsets, averaged | Robust, little tuning | Larger, less interpretable |
| **Gradient boosting** (XGBoost, LightGBM, CatBoost) | Trees added one by one, each correcting the last | Usually the best accuracy on tabular data | More tuning, can overfit |
| **k-nearest neighbours** | Predict from the most similar past examples | Simple, no training | Slow at scale, sensitive to feature scaling |
| **Support vector machines** | Find the widest margin between classes | Good on small, high-dimensional data | Scales poorly, less used today |
| **k-means and other clustering** | Group by distance | Simple segmentation | You must choose the number of clusters; assumes round clusters |
| **Neural networks** | Layers of learned transformations | Unstructured data, very large datasets | Data- and compute-hungry, opaque |

Rule of thumb: on **tabular business data**, gradient-boosted trees beat deep learning more often than
not, and logistic regression is the baseline to beat.

A minimal supervised workflow in Python with scikit-learn:

```python
from sklearn.model_selection import train_test_split
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import classification_report

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, stratify=y, random_state=0)
model = HistGradientBoostingClassifier().fit(X_train, y_train)
print(classification_report(y_test, model.predict(X_test)))
```

---

## 5. Overfitting, underfitting and the bias–variance trade-off

- **Underfitting (high bias)** — the model is too simple to capture the pattern; poor on training and
  test data alike.
- **Overfitting (high variance)** — the model memorises training noise; excellent on training data,
  poor on new data.
- **Remedies for overfitting** — more data, simpler models, **regularisation** (penalising
  complexity), early stopping, dropout in neural networks, cross-validation to choose settings.
- **Learning curves** — plot performance against training-set size. If validation performance is
  still climbing, more data will help; if it has flattened, more data will not, and a better model or
  better features might.

The product question this answers: *should we pay to label more data?*

---

## 6. Deep learning

A neural network stacks layers of simple units. Each layer transforms its input; training adjusts
millions or billions of **weights** by **gradient descent**, using **backpropagation** to work out
how each weight contributed to the error.

Why it matters: deep networks learn their own **representations**. Instead of an engineer hand-crafting
features ("count the edges in the image"), early layers learn edges, later layers learn shapes, and
the last layers learn objects. That is why deep learning dominates images, audio, video and language.

The costs: large amounts of data (unless you start from a pre-trained model), specialised compute
(GPUs), long training, and weak interpretability.

---

## 7. Architectures worth recognising

- **Convolutional neural networks (CNNs)** — slide small learned filters across an image; the
  workhorse of vision for a decade (classification, detection, segmentation).
- **Recurrent networks (RNNs, LSTMs)** — process sequences step by step; largely replaced by
  transformers.
- **Transformers** — use **attention** to let every part of the input look at every other part; the
  architecture behind modern language models and, increasingly, vision and audio.
- **Embeddings** — a learned vector of numbers representing a word, document, image or user, placed so
  that similar things sit close together. They power semantic search, recommendations, clustering and
  retrieval for language models.
- **Autoencoders** — compress and reconstruct input; used for anomaly detection and compression.
- **Diffusion models** — generate images by learning to remove noise step by step.

---

## 8. Transfer learning

Most deep-learning products do not train from scratch. They take a model **pre-trained** on a huge
general dataset and **fine-tune** it on a small task-specific one. A pre-trained image model can learn
to recognise a new product defect from hundreds of labelled images rather than millions. For a product
plan, this changes the data requirement by orders of magnitude.

---

## 9. Foundation models and large language models

A **foundation model** is pre-trained on broad data and adapted to many tasks. Large language models
(LLMs) are trained to predict the next **token** (a word piece) and then tuned to follow instructions
and to match human preferences.

**Ways to adapt one, cheapest first:**

1. **Prompting** — instructions plus a few examples (**few-shot**) in the input.
2. **Retrieval-augmented generation (RAG)** — fetch relevant documents (usually by embedding
   similarity) and put them in the prompt, so answers are grounded in your content and can cite it.
3. **Tool use and agents** — let the model call functions (search, a database, an API) and act over
   several steps.
4. **Fine-tuning** — further training on your examples, for consistent format, style or a specialised
   task.
5. **Training your own** — rarely justified outside very large organisations.

**What a product builder must plan for:**

- **Hallucination** — fluent, confident, wrong output. Mitigate with grounding, citations, constrained
  output and human review where it matters.
- **Non-determinism** — the same input can give different outputs.
- **Context window** — how much text fits in one request.
- **Cost and latency per call** — priced per token; long prompts and long answers cost more and take
  longer.
- **Evaluation** — free-text output needs rubrics, reference answers or model-graded checks, not
  just accuracy.
- **Prompt injection** — instructions hidden in content the model reads can override yours.

---

## 10. Choosing an approach

| Situation | Usually start with |
|---|---|
| Tabular data, labelled outcomes | Logistic regression baseline, then gradient boosting |
| Images, a few thousand labelled examples | Fine-tune a pre-trained vision model |
| Text classification with labels | A small fine-tuned language model, or an LLM with few-shot prompts to start |
| Text tasks with almost no labels | An LLM with prompting, evaluated on a small hand-labelled set |
| Questions over your own documents | Retrieval-augmented generation |
| No labels, need groups | Clustering on embeddings or engineered features |
| Rare events | Anomaly detection, or classification with care for class imbalance |
| Explanations required by regulation | An interpretable model, or a simple model alongside the complex one |

Whatever is chosen, ask for the **baseline** it was compared to and the **test data** it was scored
on. A plan without both cannot be judged.
