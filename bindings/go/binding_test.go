package tree_sitter_pug_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_pug "github.com/zealot128/tree-sitter-pug/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_pug.Language())
	if language == nil {
		t.Errorf("Error loading Pug grammar")
	}
}
