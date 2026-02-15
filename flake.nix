{
  description = "Nonogram web app (Cloudflare Pages + D1)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/bcef7b39781011d4332b54f59e989d4d4c22d643";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            jq
            opentofu
          ];

          shellHook = ''
            echo "Nonogram environment loaded"
            echo "  Node: $(node --version)"
            echo "  npm: $(npm --version)"
            echo "  OpenTofu: $(tofu --version | head -1)"
          '';
        };
      });
}
