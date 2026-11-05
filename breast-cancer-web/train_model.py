#!/usr/bin/env python3
"""
Train the best model from the project (ANN / MLPClassifier) and save it for the web app.

Usage
-----
    python train_model.py                 # uses the best hyperparameters found in the project
    python train_model.py --tune          # re-runs the GridSearchCV for the ANN first
    python train_model.py --full          # after evaluation, refit on ALL data for deployment

Data: put the UCI file `breast-cancer-wisconsin.data` inside the ./data folder.
If it is not there, the script tries to download it from the UCI repository.
"""
import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

BASE = Path(__file__).resolve().parent
UCI_URL = ("https://archive.ics.uci.edu/ml/machine-learning-databases/"
           "breast-cancer-wisconsin/breast-cancer-wisconsin.data")
COLUMNS = ["id", "clump_thickness", "uniformity_cell_size", "uniformity_cell_shape",
           "marginal_adhesion", "single_epithelial_cell_size", "bare_nuclei",
           "bland_chromatin", "normal_nucleoli", "mitoses", "class"]
FEATURES = COLUMNS[1:-1]
RANDOM_STATE = 42

# Best ANN found in the project (5-fold CV, scoring = F1, malignant = positive class)
BEST_PARAMS = {"hidden_layer_sizes": (32,), "activation": "relu",
               "alpha": 0.0001, "learning_rate_init": 0.001}
TUNING_GRID = {
    "model__hidden_layer_sizes": [(16,), (32,), (32, 16)],
    "model__activation": ["relu", "tanh"],
    "model__alpha": [0.0001, 0.001, 0.01],
    "model__learning_rate_init": [0.001, 0.01],
}
# Test-set results reported in the project notebook (for a sanity check)
REFERENCE = {"accuracy": 0.9712, "precision": 0.9583, "recall": 0.9583,
             "f1": 0.9583, "roc_auc": 0.9961}


def find_data_source(explicit):
    if explicit:
        return explicit
    candidates = sorted((BASE / "data").glob("*breast*"))
    if candidates:
        return str(candidates[0])
    print("No local data file found in ./data, downloading from UCI ...")
    return UCI_URL


def make_pipeline(params):
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("model", MLPClassifier(max_iter=2000, random_state=RANDOM_STATE, **params)),
    ])


def evaluate(pipe, X, y):
    pred = pipe.predict(X)
    proba = pipe.predict_proba(X)[:, 1]
    tn, fp, fn, tp = confusion_matrix(y, pred).ravel()
    return {
        "accuracy": round(accuracy_score(y, pred), 4),
        "precision": round(precision_score(y, pred), 4),
        "recall": round(recall_score(y, pred), 4),
        "f1": round(f1_score(y, pred), 4),
        "roc_auc": round(roc_auc_score(y, proba), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="path or URL of breast-cancer-wisconsin.data")
    ap.add_argument("--tune", action="store_true", help="re-run GridSearchCV for the ANN")
    ap.add_argument("--full", action="store_true", help="refit on all data after evaluation")
    args = ap.parse_args()

    source = find_data_source(args.data)
    print("Loading:", source)
    try:
        df = pd.read_csv(source, header=None, names=COLUMNS, na_values="?")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Could not read the dataset ({exc}).\n"
                 f"Download {UCI_URL} and save it in the ./data folder.")

    if df.shape[1] != len(COLUMNS) or len(df) < 600:
        sys.exit("Unexpected file shape. Make sure you are using the *Original* dataset (699 rows).")

    print(f"Raw shape: {df.shape} | missing: {int(df.isnull().sum().sum())}")
    df = df.drop_duplicates().reset_index(drop=True)          # exact duplicates (ID included)
    X = df[FEATURES]
    y = (df["class"] == 4).astype(int)                         # malignant = 1 (positive class)
    print(f"After removing duplicates: {len(df)} samples | malignant: {int(y.sum())}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=RANDOM_STATE)

    params = dict(BEST_PARAMS)
    if args.tune:
        print("Running GridSearchCV (this takes about a minute) ...")
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
        gs = GridSearchCV(make_pipeline({}), TUNING_GRID, cv=cv, scoring="f1", n_jobs=-1)
        gs.fit(X_train, y_train)
        params = {k.replace("model__", ""): v for k, v in gs.best_params_.items()}
        print("Best params:", params, "| CV F1 =", round(gs.best_score_, 4))

    pipe = make_pipeline(params).fit(X_train, y_train)
    metrics = evaluate(pipe, X_test, y_test)

    print("\nTest-set results (malignant = positive):")
    for k in ["accuracy", "precision", "recall", "f1", "roc_auc"]:
        ref = f"  (project notebook: {REFERENCE[k]})" if not args.tune else ""
        print(f"  {k:<10}{metrics[k]:.4f}{ref}")
    print("  confusion matrix:", metrics["confusion_matrix"])

    # Which features matter most? Permutation importance on the test set (drop in F1 when shuffled)
    perm = permutation_importance(pipe, X_test, y_test, scoring="f1", n_repeats=30,
                                  random_state=RANDOM_STATE)
    importance = sorted(
        ({"feature": f, "importance": round(float(m), 4), "std": round(float(sd), 4)}
         for f, m, sd in zip(FEATURES, perm.importances_mean, perm.importances_std)),
        key=lambda d: d["importance"], reverse=True)

    deployed = pipe
    if args.full:
        deployed = make_pipeline(params).fit(X, y)
        print("\nRefit the deployed model on all", len(X), "samples.")

    (BASE / "model").mkdir(exist_ok=True)
    joblib.dump({"pipeline": deployed, "features": FEATURES}, BASE / "model" / "model.joblib")
    info = {
        "model": "Artificial Neural Network (MLPClassifier)",
        "params": {k: (list(v) if isinstance(v, tuple) else v) for k, v in params.items()},
        "n_samples": int(len(df)), "n_train": int(len(X_train)), "n_test": int(len(X_test)),
        "positive_class": "malignant",
        "test_metrics": metrics,
        "feature_importance": importance,
        "deployed_on_all_data": bool(args.full),
    }
    (BASE / "model" / "metrics.json").write_text(json.dumps(info, indent=2))
    print("\nSaved model/model.joblib and model/metrics.json")


if __name__ == "__main__":
    main()
