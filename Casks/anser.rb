cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "0.1.23"
  sha256 arm:   "c02501018ee2e149faa085a4996db3f90e60e04b982eb2bc411491bff67d72ea",
         intel: "98cd8e3a3bc4464400a929d7e3f81d8548aa74b537667c1060965ea8181b6e9b"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
