{
  inputs = {
    nixpkgs = {
      url = "github:NixOS/nixpkgs/26.05";
    };
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [
              (final: prev: {
                python3 = prev.python313;
                python3Packages = prev.python313Packages;
              })
            ];
          };
        in
        {
          default = pkgs.writers.writePython3Bin "generate-global-tracker-data" {
            doCheck = false;
            libraries = with pkgs.python3Packages; [
              pyyaml
              pathspec
              typing-extensions
              schema
              bsdiff4

              orjson
              requests
              jinja2
              colorama
              websockets
              (pkgs.python313Packages.buildPythonPackage rec {
                pname = "pyevermizer";
                version = "0.50.1";
                pyproject = true;

                src = pkgs.fetchPypi {
                  inherit pname version;
                  hash = "sha256-zVbMom7ZZ1eQFU3XBAKtKKOB/DyQMb0C65sdrYwxc5g=";
                };
                build-system = [
                  pkgs.python313Packages.hatchling
                  pkgs.python313Packages.setuptools
                ];
                doCheck = false;
              })
            ];
          } ./generate-global-tracker-data.py;
        }
      );
    };
}
